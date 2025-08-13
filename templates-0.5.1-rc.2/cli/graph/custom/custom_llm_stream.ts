import 'dotenv/config';

import {
  CustomNode,
  GraphBuilder,
  GraphTypes,
  ProcessContext,
  RemoteLLMChatNode,
} from '@inworld/runtime/graph';

import { bindProcessHandlers, parseArgs } from '../../helpers/cli_helpers';

class CustomStreamReaderNode extends CustomNode {
  async process(
    _context: ProcessContext,
    contentStream: GraphTypes.ContentStream,
  ): Promise<string> {
    let result = '';
    for await (const chunk of contentStream) {
      if (chunk.text) result += chunk.text;
    }
    return result;
  }
}

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

  const llmNode = new RemoteLLMChatNode({
    id: 'llm-node',
    provider,
    modelName,
    stream: true,
  });

  const customNode = new CustomStreamReaderNode();

  const graph = new GraphBuilder({
    id: 'custom_llm_stream_graph',
    apiKey,
    enableRemoteConfig: false,
  })
    .addNode(llmNode)
    .addNode(customNode)
    .addEdge(llmNode, customNode)
    .setStartNode(llmNode)
    .setEndNode(customNode)
    .build();

  const outputStream = graph.start(
    new GraphTypes.LLMChatRequest({
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  );
  const result = await outputStream.next();
  result.processResponse({
    string: (data) => {
      console.log(`LLM stream result: ${data}`);
    },
    default: (data) => {
      console.log('Unprocessed data:', data);
    },
  });
}

bindProcessHandlers();
