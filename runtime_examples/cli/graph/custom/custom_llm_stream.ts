import 'dotenv/config';

import {
  CustomInputDataType,
  CustomOutputDataType,
  GraphBuilder,
  NodeFactory,
  registerCustomNodeType,
} from '@inworld/runtime/graph';
import { v4 } from 'uuid';

import { TEXT_CONFIG } from '../../constants';
import {
  bindProcessHandlers,
  cleanup,
  parseArgs,
} from '../../helpers/cli_helpers';

const customStreamReaderNodeType = registerCustomNodeType(
  'custom-stream-reader',
  [CustomInputDataType.CONTENT_STREAM],
  CustomOutputDataType.TEXT,
  async (_context, contentStream) => {
    let result = '';
    let chunk = await contentStream.next();

    while (!chunk.done) {
      result += chunk.text;
      chunk = await contentStream.next();
    }
    return result;
  },
);

const usage = `
Usage:
    yarn node-custom-llm-stream "Hello, world"
Description:
    This example demonstrates how to create a custom node that streams a LLM response.
    The node is asynchronous and will return the LLM response.
`;

run();

async function run() {
  const { prompt, modelName, provider, apiKey } = parseArgs(usage);

  const llmNode = NodeFactory.createRemoteLLMChatNode({
    id: 'llm-node',
    llmConfig: {
      provider,
      modelName,
      apiKey,
      stream: true,
      textGenerationConfig: TEXT_CONFIG,
    },
  });

  const customNode = NodeFactory.createCustomNode(
    'custom-stream-reader-node',
    customStreamReaderNodeType,
  );

  const executor = new GraphBuilder('custom_llm_stream_graph')
    .addNode(llmNode)
    .addNode(customNode)
    .addEdge(llmNode, customNode)
    .setStartNode(llmNode)
    .setEndNode(customNode)
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
  const result = (await outputStream.next()).data;

  console.log(`LLM stream result: ${result}`);

  cleanup(executor, outputStream);
}

bindProcessHandlers();
