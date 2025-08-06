import 'dotenv/config';

import {
  ContentStreamIterator,
  TextStreamIterator,
} from '@inworld/runtime/common';
import {
  EmojiRemover,
  TextInBracketsRemover,
} from '@inworld/runtime/core/text_processing';
import {
  CustomInputDataType,
  CustomOutputDataType,
  GraphBuilder,
  GraphOutputStreamResponseType,
  NodeFactory,
  registerCustomNodeType,
} from '@inworld/runtime/graph';
import { renderJinja } from '@inworld/runtime/primitives/llm';
import { v4 } from 'uuid';

import { DEFAULT_LLM_MODEL_NAME, TEXT_CONFIG } from '../../constants';
import {
  bindProcessHandlers,
  cleanup,
  parseArgs,
} from '../../helpers/cli_helpers';

const dialogPromptBuilderNodeType = registerCustomNodeType(
  'DialogPromptBuilderNode',
  [CustomInputDataType.TEXT],
  CustomOutputDataType.CHAT_REQUEST,
  async (_context, input) => {
    const content = await renderJinja(prompt, {
      user_input: input,
    });
    return [
      {
        role: 'user',
        content,
      },
    ];
  },
);

const postprocessingNodeType = registerCustomNodeType(
  'PostprocessingNode',
  [CustomInputDataType.TEXT_STREAM],
  CustomOutputDataType.TEXT_STREAM,
  async (_context, input) => {
    const emojiRemoverStream = await EmojiRemover.create(input.getStream());
    return await TextInBracketsRemover.create(emojiRemoverStream.getStream());
  },
);

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

  const dialogPromptBuilderNode = NodeFactory.createCustomNode(
    'dialog-prompt-builder-node',
    dialogPromptBuilderNodeType,
  );

  const postprocessingNode = NodeFactory.createCustomNode(
    'postprocessing-node',
    postprocessingNodeType,
  );

  const llmNode = await NodeFactory.createRemoteLLMChatNode({
    id: 'llm-node',
    llmConfig: {
      provider,
      modelName,
      apiKey,
      textGenerationConfig: TEXT_CONFIG,
      reportToClient: true,
      stream: true,
    },
  });

  const textChunkingNode = NodeFactory.createTextChunkingNode({
    id: 'text-chunking-node',
  });

  const executor = new GraphBuilder('custom_response_processing_graph')
    .addNode(dialogPromptBuilderNode)
    .addNode(llmNode)
    .addNode(textChunkingNode)
    .addNode(postprocessingNode)
    .addEdge(dialogPromptBuilderNode, llmNode)
    .addEdge(llmNode, textChunkingNode)
    .addEdge(textChunkingNode, postprocessingNode)
    .setStartNode(dialogPromptBuilderNode)
    .setEndNode(postprocessingNode)
    .getExecutor();

  const outputStream = await executor.execute(prompt, v4());

  let done = false;
  while (!done) {
    const result = await outputStream.next();
    switch (result.type) {
      case GraphOutputStreamResponseType.CONTENT_STREAM:
        const contentStream = result.data as ContentStreamIterator;
        let llmChunkDone = false;
        let llmResult = '';
        while (!llmChunkDone) {
          const chunk = await contentStream.next();
          llmResult += chunk.text;
          llmChunkDone = chunk.done;
        }
        console.log('>>> LLM report to client result:', llmResult);
        break;
      case GraphOutputStreamResponseType.TEXT_STREAM:
        const textStream = result.data as TextStreamIterator;
        let textChunkDone = false;
        let textResult = '';
        while (!textChunkDone) {
          const chunk = await textStream.next();
          textResult += chunk.text;
          textChunkDone = chunk.done;
        }
        console.log(`PostProcessing Result: ${textResult}`);
        break;
    }
    done = result.done;
  }

  cleanup(executor, outputStream);
}

bindProcessHandlers();
