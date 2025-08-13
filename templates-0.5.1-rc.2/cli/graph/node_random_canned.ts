import 'dotenv/config';

import { GraphBuilder, RandomCannedTextNode } from '@inworld/runtime/graph';

import { bindProcessHandlers } from '../helpers/cli_helpers';

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

  const randomCannedNode = new RandomCannedTextNode({
    cannedPhrases,
  });

  const graph = new GraphBuilder({
    id: 'node_random_canned_graph',
    apiKey: process.env.INWORLD_API_KEY || '',
    enableRemoteConfig: false,
  })
    .addNode(randomCannedNode)
    .setStartNode(randomCannedNode)
    .setEndNode(randomCannedNode)
    .build();

  const outputStream = graph.start('');
  let textResult: string | undefined;
  for await (const resp of outputStream) {
    resp.processResponse({
      string: (text: string) => {
        textResult = text;
      },
    });
  }

  console.log('Initial phrases: ');
  cannedPhrases.forEach((phrase, index) => {
    console.log(`${index + 1}. ${phrase}`);
  });

  console.log('Randomly selected phrase:\n', textResult);
}

function parseArgs() {
  const argv = minimist(process.argv.slice(2));

  if (argv.help) {
    console.log(usage);
    process.exit(0);
  }
}

bindProcessHandlers();
