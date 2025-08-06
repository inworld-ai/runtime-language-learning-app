import 'dotenv/config';

import {
  CustomInputDataType,
  CustomOutputDataType,
  GraphBuilder,
  NodeFactory,
  registerCustomNodeType,
} from '@inworld/runtime/graph';
import { v4 } from 'uuid';

import {
  bindProcessHandlers,
  cleanup,
  parseArgs,
} from '../../helpers/cli_helpers';

const reverseTextNodeType = registerCustomNodeType(
  'reverse-text',
  [CustomInputDataType.TEXT],
  CustomOutputDataType.TEXT,
  (_context, input) => {
    return input.split('').reverse().join('');
  },
);

const usage = `
Usage:
    yarn node-custom-reverse "Hello, world"
Description:
    This example demonstrates how to create a custom node that reverses a string.
    The node is synchronous and will return the reversed string immediately.
`;

run();

async function run() {
  const { prompt } = parseArgs(usage);

  const customNode = NodeFactory.createCustomNode(
    'reverse-text-node',
    reverseTextNodeType,
  );

  const executor = new GraphBuilder('custom_reverse_graph')
    .addNode(customNode)
    .setStartNode(customNode)
    .setEndNode(customNode)
    .getExecutor();

  const outputStream = await executor.execute(prompt, v4());
  const result = (await outputStream.next()).data;

  console.log(`Reversed text: ${result}`);

  cleanup(executor, outputStream);
}

bindProcessHandlers();
