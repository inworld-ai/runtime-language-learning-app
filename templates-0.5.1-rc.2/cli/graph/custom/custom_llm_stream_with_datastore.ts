import 'dotenv/config';

import {
  CustomNode,
  GraphBuilder,
  GraphTypes,
  ProcessContext,
  RemoteLLMChatNode,
} from '@inworld/runtime/graph';

import { bindProcessHandlers, parseArgs } from '../../helpers/cli_helpers';

class CustomDatastoreWriterNode extends CustomNode {
  async process(
    context: ProcessContext,
    input: { userId: string; chatRequest: GraphTypes.LLMChatRequest },
  ): Promise<GraphTypes.LLMChatRequest> {
    const { userId, chatRequest } = input;
    const datastore = context.getDatastore();
    datastore.add('userId', userId);
    return new GraphTypes.LLMChatRequest(chatRequest.request);
  }
}

class CustomStreamReaderNode extends CustomNode {
  async process(
    context: ProcessContext,
    contentStream: GraphTypes.ContentStream,
  ): Promise<string> {
    let result = '';
    console.log(
      `Text stream for user: ${context.getDatastore().get('userId')}`,
    );
    for await (const chunk of contentStream) {
      if (chunk.text) result += chunk.text;
      process.stdout.write(chunk.text);
    }
    return result;
  }
}

const usage = `
Usage:
    yarn node-custom-llm-stream-with-datastore "Hello, world"
Description:
    This example demonstrates how to create a custom node that streams a LLM response.
    The node is asynchronous and will return the LLM response.
`;

run();

async function run() {
  const { prompt, modelName, provider, apiKey } = parseArgs(usage);

  const datastoreWriterNode = new CustomDatastoreWriterNode();
  const llmNode = new RemoteLLMChatNode({
    id: 'llm-node',
    provider,
    modelName,
    stream: true,
  });

  const customStreamReaderWithDatastoreNode = new CustomStreamReaderNode();

  const graph = new GraphBuilder({
    id: 'custom_llm_stream_with_datastore_graph',
    apiKey,
    enableRemoteConfig: false,
  })
    .addNode(datastoreWriterNode)
    .addNode(llmNode)
    .addNode(customStreamReaderWithDatastoreNode)
    .addEdge(datastoreWriterNode, llmNode)
    .addEdge(llmNode, customStreamReaderWithDatastoreNode)
    .setStartNode(datastoreWriterNode)
    .setEndNode(customStreamReaderWithDatastoreNode)
    .build();

  const outputStream = graph.start({
    userId: 'Test Datastore User',
    chatRequest: new GraphTypes.LLMChatRequest({
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });
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
