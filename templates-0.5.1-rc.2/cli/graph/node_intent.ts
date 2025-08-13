import 'dotenv/config';

import { GraphBuilder, ProxyNode, SubgraphNode } from '@inworld/runtime/graph';
import * as fs from 'fs';
import * as path from 'path';

import { bindProcessHandlers } from '../helpers/cli_helpers';

const promptTemplate = fs.readFileSync(
  path.resolve(__dirname, 'fixtures/intent_matching_prompt_template.txt'),
  'utf-8',
);

const intents = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'fixtures/intents.json'), 'utf-8'),
);

const minimist = require('minimist');

const usage = `
Usage:
    yarn node-subgraph "This is a long text, that needs to be chunked and aggregated" \n
    OR \n
    yarn node-subgraph --file=graph/node_subgraph.ts`;

run();

async function run() {
  const { text } = parseArgs();

  const builtInIntentSubgraphNode = new SubgraphNode({
    subgraphId: 'intent_subgraph',
  });

  const inputProxyNode = new ProxyNode();

  const outputProxyNode = new ProxyNode();

  const graphBuilder = new GraphBuilder('node_subgraph_graph')
    .addIntentSubgraph('intent_subgraph', {
      intents,
      promptTemplate,
    })
    .addNode(inputProxyNode)
    .addNode(builtInIntentSubgraphNode)
    .addNode(outputProxyNode)
    .addEdge(inputProxyNode, builtInIntentSubgraphNode)
    .addEdge(builtInIntentSubgraphNode, outputProxyNode)
    .setStartNode(inputProxyNode)
    .setEndNode(outputProxyNode);

  const graph = graphBuilder.build();

  const outputStream = graph.start(text);

  for await (const response of outputStream) {
    await response.processResponse({
      MatchedIntents: (matchedIntents) => {
        console.log('Intent matches:', matchedIntents.intents);
      },
    });
  }
}

function parseArgs(): {
  text: string;
} {
  const argv = minimist(process.argv.slice(2));

  if (argv.help) {
    console.log(usage);
    process.exit(0);
  }

  let text = '';

  if (argv.file) {
    const filePath = path.resolve(argv.file);
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }
      text = fs.readFileSync(filePath, 'utf-8');
      console.log(`Reading input from file: ${filePath}`);
    } catch (error) {
      throw new Error(`Error reading file: ${error.message}\n${usage}`);
    }
  } else {
    text = argv._?.join(' ');
  }

  if (!text) {
    throw new Error(
      `You need to provide text to chunk or a file path.\n${usage}`,
    );
  }

  return { text };
}

bindProcessHandlers();
