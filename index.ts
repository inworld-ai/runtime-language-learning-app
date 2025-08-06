import 'dotenv/config';

const apiKey = process.env.INWORLD_API_KEY;
if (!apiKey) {
  throw new Error(
    'INWORLD_API_KEY environment variable is not set! Either add it to .env file in the root of the package or export it to the shell.',
  );
}

import {
  CustomInputDataType,
  CustomOutputDataTypeTyped,
  GraphBuilder,
  GraphOutputStreamResponseType,
  NodeFactory,
  registerCustomNodeType,
} from '@inworld/runtime/graph';
import { v4 } from 'uuid';

interface CustomTextOutput {
  processedText: string;
}
// Creating the reference to the custom node type where you can process the input text
const customTextNodeType = registerCustomNodeType(
  'CustomText',
  [CustomInputDataType.TEXT],
  CustomOutputDataTypeTyped<CustomTextOutput>(),
  async (context, input) => {
    return {
      processedText: input.toUpperCase(),
    };
  },
);

// Using the reference to create a node instance
const customTextNode = NodeFactory.createCustomNode(
  'custom-text-node',
  customTextNodeType,
);

// Creating a graph builder instance and adding the node to it
const graphBuilder = new GraphBuilder()
  .addNode(customTextNode)
  .setStartNode(customTextNode)
  .setEndNode(customTextNode);

// Creating an executor instance from the graph builder
const executor = graphBuilder.getExecutor();

main();

// Main function that executes the graph
async function main() {
  // Execute graph and waiting for output stream to be returned.
  const outputStream = await executor.execute('Hello, world!', v4());

  // Unwrapping the output stream to get the first result (in our case it's the only result).
  const result = await outputStream.next();

  // Checking if the result is a custom data type result.
  if (result.type === GraphOutputStreamResponseType.CUSTOM) {
    // If it is, we can access the data property of the result.
    process.stdout.write(
      `Graph execution result: ${JSON.stringify(result.data, null, 2)}\n`,
    );
  }

  // Cleaning up the executor and destroying the graph builder.
  executor.cleanupAllExecutions();
  executor.destroy();
}
