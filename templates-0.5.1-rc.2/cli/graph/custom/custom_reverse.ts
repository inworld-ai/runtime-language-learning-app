import 'dotenv/config';

import {
  CustomNode,
  GraphBuilder,
  ProcessContext,
} from '@inworld/runtime/graph';

import { bindProcessHandlers, parseArgs } from '../../helpers/cli_helpers';

class ReverseTextNode extends CustomNode {
  process(_context: ProcessContext, input: string): string {
    return input.split('').reverse().join('');
  }
}

const usage = `
Usage:
    yarn node-custom-reverse "Hello, world"
Description:
    This example demonstrates how to create a custom node that reverses a string.
    The node is synchronous and will return the reversed string immediately.
`;

run();

async function run() {
  const { prompt, apiKey } = parseArgs(usage);

  const customNode = new ReverseTextNode();

  const graph = new GraphBuilder({
    id: 'custom_reverse_graph',
    apiKey,
    enableRemoteConfig: false,
  })
    .addNode(customNode)
    .setStartNode(customNode)
    .setEndNode(customNode)
    .build();

  const outputStream = graph.start(prompt);
  const result = await outputStream.next();
  result.processResponse({
    string: (data) => console.log(`Reversed text: ${data}`),
    default: (data) => console.log('Unprocessed data:', data),
  });
}

bindProcessHandlers();
