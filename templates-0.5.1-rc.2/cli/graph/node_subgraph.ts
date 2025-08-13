import 'dotenv/config';

import {
  GraphBuilder,
  ProxyNode,
  SubgraphBuilder,
  SubgraphNode,
  TextAggregatorNode,
  TextChunkingNode,
} from '@inworld/runtime/graph';
import * as fs from 'fs';
import * as path from 'path';
import { stdout } from 'process';

import { bindProcessHandlers } from '../helpers/cli_helpers';

const minimist = require('minimist');

// Create the text processing subgraph using DSL

const subgraphTextChunkingNode = new TextChunkingNode({ reportToClient: true });
const subgraphTextAggregatorNode = new TextAggregatorNode();

const textProcessingSubgraph = new SubgraphBuilder('text_processing_subgraph')
  .addNode(subgraphTextChunkingNode)
  .addNode(subgraphTextAggregatorNode)
  .addEdge(subgraphTextChunkingNode, subgraphTextAggregatorNode)
  .setStartNode(subgraphTextChunkingNode)
  .setEndNode(subgraphTextAggregatorNode);

const textProcessingSubgraphNode = new SubgraphNode({
  subgraphId: 'text_processing_subgraph',
});

const inputProxyNode = new ProxyNode();
const outputProxyNode = new ProxyNode();

const usage = `
Usage:
    yarn node-subgraph "This is a long text, that needs to be chunked and aggregated" \n
    OR \n
    yarn node-subgraph --file=graph/node_subgraph.ts`;

run();

async function run() {
  const { text } = parseArgs();

  const graph = new GraphBuilder({
    id: 'node_subgraph_graph',
    enableRemoteConfig: false,
  })
    .addSubgraph(textProcessingSubgraph)
    .addNode(inputProxyNode)
    .addNode(textProcessingSubgraphNode)
    .addNode(outputProxyNode)
    .addEdge(inputProxyNode, textProcessingSubgraphNode)
    .addEdge(textProcessingSubgraphNode, outputProxyNode)
    .setStartNode(inputProxyNode)
    .setEndNode(outputProxyNode)
    .build();

  console.log(graph.toJSON());

  const outputStream = graph.start(text);

  let resultCount = 0;
  let resultText = '';

  for await (const result of outputStream) {
    resultCount++;
    await result.processResponse({
      TextStream: async (textStream) => {
        console.log('Text chunking stream:');
        for await (const chunk of textStream) {
          resultCount++;
          stdout.write(chunk.text);
        }
      },
      string: (string) => {
        resultText = string;
      },
    });
  }

  console.log(`\nInput text length: ${text.length} characters`);
  console.log(`Number of chunks: ${resultCount}`);
  console.log(`\nAggregated text: ${resultText}`);
}

function parseArgs(): { text: string } {
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
