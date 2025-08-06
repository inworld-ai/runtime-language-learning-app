import 'dotenv/config';

import { ContentToStringStream } from '@inworld/runtime/core';
import {
  CustomInputDataType,
  CustomOutputDataType,
  GraphBuilder,
  NodeFactory,
  registerCustomNodeType,
} from '@inworld/runtime/graph';
import { v4 } from 'uuid';

import {
  DEFAULT_LLM_MODEL_NAME,
  DEFAULT_PROVIDER,
  TEXT_CONFIG,
} from '../../constants';
import {
  bindProcessHandlers,
  cleanup,
  parseArgs,
} from '../../helpers/cli_helpers';

const textToTextStreamTransformationNodeType = registerCustomNodeType(
  'text_to_text_stream_transformation',
  [CustomInputDataType.TEXT_STREAM],
  CustomOutputDataType.TEXT_STREAM,
  async (_ontext, input) => {
    return input.toTextResponse({
      transform: (text: string) => {
        return text.toLocaleLowerCase();
      },
    });
  },
);

const prepareTextChunkingNodeType = registerCustomNodeType(
  'prepare-text-chunking',
  [CustomInputDataType.CONTENT_STREAM],
  CustomOutputDataType.TEXT_STREAM,
  async (_context, input) => {
    return new ContentToStringStream(input.getStream());
  },
);

const usage = `
Usage:
    yarn node-custom-text-to-text-stream "Hello, how are you?"
Description:
    This example demonstrates how to create a custom node with text stream as an input.
    It will convert each stream text chunk to lower case`;

run();

async function run() {
  const { prompt, apiKey } = parseArgs(usage);

  const textToTextNode = NodeFactory.createCustomNode(
    'text-to-text-stream-transformation-node',
    textToTextStreamTransformationNodeType,
  );

  const prepareTextChunkingNode = NodeFactory.createCustomNode(
    'prepare-text-chunking-node',
    prepareTextChunkingNodeType,
  );

  const llmNode = await NodeFactory.createRemoteLLMChatNode({
    id: 'llm-node',
    llmConfig: {
      modelName: DEFAULT_LLM_MODEL_NAME,
      apiKey,
      provider: DEFAULT_PROVIDER,
      stream: true,
      textGenerationConfig: TEXT_CONFIG,
    },
  });

  const textChunkingNode = NodeFactory.createTextChunkingNode({
    id: 'text-chunking-node',
  });

  const executor = new GraphBuilder(
    'custom_text_to_text_stream_transformation_graph',
  )
    .addNode(llmNode)
    .addNode(prepareTextChunkingNode)
    .addNode(textChunkingNode)
    .addNode(textToTextNode)
    .setStartNode(llmNode)
    .addEdge(llmNode, prepareTextChunkingNode)
    .addEdge(prepareTextChunkingNode, textChunkingNode)
    .addEdge(textChunkingNode, textToTextNode)
    .setEndNode(textToTextNode)
    .getExecutor();

  const outputStream = await executor.execute(
    [
      {
        role: 'user',
        content: prompt,
      },
    ],
    v4(),
  );

  const llmStream = (await outputStream.next()).data as any;
  let llmResult = '';
  let llmChunk = await llmStream.next();
  while (!llmChunk.done) {
    llmResult += llmChunk.text;
    llmChunk = await llmStream.next();
  }
  console.log(`LLM Result: ${llmResult}`);

  cleanup(executor, outputStream);
}
bindProcessHandlers();
