import 'dotenv/config';

import {
  EmojiRemover,
  TextInBracketsRemover,
} from '@inworld/runtime/core/text_processing';
import {
  CustomNode,
  GraphBuilder,
  GraphTypes,
  ProcessContext,
  RemoteLLMChatNode,
  TextChunkingNode,
} from '@inworld/runtime/graph';
import { renderJinja } from '@inworld/runtime/primitives/llm';

import { DEFAULT_LLM_MODEL_NAME } from '../../constants';
import { bindProcessHandlers, parseArgs } from '../../helpers/cli_helpers';

class DialogPromptBuilderNode extends CustomNode {
  async process(_context: ProcessContext, input: string) {
    const content = await renderJinja(prompt, {
      user_input: input,
    });
    return new GraphTypes.LLMChatRequest({
      messages: [
        {
          role: 'user',
          content,
        },
      ],
    });
  }
}

class PostprocessingNode extends CustomNode {
  async process(_context: ProcessContext, input: GraphTypes.TextStream) {
    const emojiRemoverStream = await EmojiRemover.create(input.getStream());
    const bracketsRemover = await TextInBracketsRemover.create(
      emojiRemoverStream.getStream(),
    );
    return new GraphTypes.TextStream(bracketsRemover.getStream());
  }
}

const prompt = `
  {{user_input}}

  # OUTPUT FORMAT
  Output should be 5 sentences long and include both emojis and brackets. Please do not include any other text, return just this 5 sentences as an output.
  `;

const usage = `
Usage:
    yarn node-custom-response-processing "Hello, how are you?" \n
    --modelName=<model-name>[optional, default=${DEFAULT_LLM_MODEL_NAME}] \n
    --provider=<service-provider>[optional, default=inworld]`;

run();

async function run() {
  const { prompt, modelName, provider, apiKey } = parseArgs(usage);

  const dialogPromptBuilderNode = new DialogPromptBuilderNode();
  const postprocessingNode = new PostprocessingNode();

  const llmNode = new RemoteLLMChatNode({
    id: 'llm-node',
    provider,
    modelName,
    reportToClient: true,
    stream: true,
  });

  const textChunkingNode = new TextChunkingNode({ id: 'text-chunking-node' });

  const graph = new GraphBuilder({
    id: 'custom_response_processing_graph',
    apiKey,
    enableRemoteConfig: false,
  })
    .addNode(dialogPromptBuilderNode)
    .addNode(llmNode)
    .addNode(textChunkingNode)
    .addNode(postprocessingNode)
    .addEdge(dialogPromptBuilderNode, llmNode)
    .addEdge(llmNode, textChunkingNode)
    .addEdge(textChunkingNode, postprocessingNode)
    .setStartNode(dialogPromptBuilderNode)
    .setEndNode(postprocessingNode)
    .build();

  const outputStream = graph.start(prompt);

  for await (const result of outputStream) {
    await result.processResponse({
      ContentStream: async (contentStream: GraphTypes.ContentStream) => {
        let llmResult = '';
        for await (const chunk of contentStream) {
          if (chunk.text) llmResult += chunk.text;
        }
        console.log('>>> LLM report to client result:', llmResult);
      },
      TextStream: async (textStream: GraphTypes.TextStream) => {
        let textResult = '';
        for await (const chunk of textStream) {
          if (chunk.text) textResult += chunk.text;
        }
        console.log(`PostProcessing Result: ${textResult}`);
      },
    });
  }
}

bindProcessHandlers();
