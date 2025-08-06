import 'dotenv/config';

import { GraphBuilder, NodeFactory } from '@inworld/runtime/graph';
import { v4 } from 'uuid';

import { bindProcessHandlers, cleanup } from '../helpers/cli_helpers';

const minimist = require('minimist');

const cannedPhrases = [
  "I'm sorry, but I can't respond to that kind of content.",
  "That topic makes me uncomfortable. Let's talk about something else.",
  "I'd prefer not to discuss that. Could we change the subject?",
];

const usage = `
Usage:
    yarn node-random-canned
    
Description:
    This is a sample graph that demonstrates the RandomCannedTextNode node.
    It will randomly select one of the canned phrases and return it.
    `;

run();

async function run() {
  parseArgs();

  const randomCannedNodeId = 'random_canned_node';
  const executor = new GraphBuilder('node_random_canned_graph')
    .addNode(
      NodeFactory.createRandomCannedTextNode({
        id: randomCannedNodeId,
        cannedPhrases,
      }),
    )
    .setStartNode(randomCannedNodeId)
    .setEndNode(randomCannedNodeId)
    .getExecutor();

  const outputStream = await executor.execute('', v4());
  const textResult = (await outputStream.next()).data as string;

  console.log('Initial phrases: ');
  cannedPhrases.forEach((phrase, index) => {
    console.log(`${index + 1}. ${phrase}`);
  });

  console.log('Randomly selected phrase: ', textResult);
  cleanup(executor, outputStream);
}

function parseArgs() {
  const argv = minimist(process.argv.slice(2));

  if (argv.help) {
    console.log(usage);
    process.exit(0);
  }
}

bindProcessHandlers();
