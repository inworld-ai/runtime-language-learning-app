import 'dotenv/config';

import { TextStreamIterator } from '@inworld/runtime/common';
import {
  GraphBuilder,
  NodeFactory,
  SubgraphBuilder,
} from '@inworld/runtime/graph';
import * as fs from 'fs';
import * as path from 'path';
import { v4 } from 'uuid';

import { bindProcessHandlers, cleanup } from '../helpers/cli_helpers';

const minimist = require('minimist');

// Create the text processing subgraph using DSL

const subgraphInputProxyNode = NodeFactory.createProxyNode({
  id: 'subgraph_input',
  reportToClient: false,
});

const subgraphTextChunkingNode = NodeFactory.createTextChunkingNode({
  id: 'text_chunking_node',
});

const subgraphProxyNode = NodeFactory.createProxyNode({
  id: 'subgraph_proxy',
  reportToClient: true,
});

const subgraphTextAggregatorNode = NodeFactory.createTextAggregatorNode({
  id: 'text_aggregator_node',
});

const subgraphOutputProxyNode = NodeFactory.createProxyNode({
  id: 'subgraph_output',
  reportToClient: false,
});

const textProcessingSubgraph = new SubgraphBuilder('text_processing_subgraph')
  .addNode(subgraphInputProxyNode)
  .addNode(subgraphTextChunkingNode)
  .addNode(subgraphProxyNode)
  .addNode(subgraphTextAggregatorNode)
  .addNode(subgraphOutputProxyNode)
  .addEdge(subgraphInputProxyNode, subgraphTextChunkingNode)
  .addEdge(subgraphTextChunkingNode, subgraphProxyNode)
  .addEdge(subgraphProxyNode, subgraphTextAggregatorNode)
  .addEdge(subgraphTextAggregatorNode, subgraphOutputProxyNode)
  .setStartNode(subgraphInputProxyNode)
  .setEndNode(subgraphOutputProxyNode);

const textProcessingSubgraphNode = NodeFactory.createSubgraphNode({
  id: 'text_processing_subgraph_node',
  subgraphId: 'text_processing_subgraph',
});

const inputProxyNode = NodeFactory.createProxyNode({
  id: 'input',
  reportToClient: false,
});

const outputProxyNode = NodeFactory.createProxyNode({
  id: 'output',
  reportToClient: false,
});

const usage = `
Usage:
    yarn node-subgraph "This is a long text, that needs to be chunked and aggregated" \n
    OR \n
    yarn node-subgraph --file=graph/node_subgraph.ts`;

run();

async function run() {
  const { text } = parseArgs();

  const executor = new GraphBuilder('node_subgraph_graph')
    .addSubgraph(textProcessingSubgraph)
    .addNode(inputProxyNode)
    .addNode(textProcessingSubgraphNode)
    .addNode(outputProxyNode)
    .addEdge(inputProxyNode, textProcessingSubgraphNode)
    .addEdge(textProcessingSubgraphNode, outputProxyNode)
    .setStartNode(inputProxyNode)
    .setEndNode(outputProxyNode)
    .getExecutor();

  const outputStream = await executor.execute(text, v4());

  let chunkStreamOutput = await outputStream.next();
  let graphTextOutput = await outputStream.next();

  console.log(graphTextOutput, chunkStreamOutput);

  const chunkingStream = chunkStreamOutput.data as TextStreamIterator;

  console.log('Chunking stream:');
  let chunk = await chunkingStream.next();
  let resultCount = 0;
  const chunks: string[] = [];

  while (!chunk.done) {
    console.log(chunk.text);
    chunks.push(chunk.text);
    resultCount++;
    chunk = await chunkingStream.next();
  }

  console.log(`Input text length: ${text.length} characters`);
  console.log(`Number of chunks: ${resultCount}`);
  console.log('Chunks:');
  chunks.forEach((chunk, index) => {
    console.log(`\nChunk ${index + 1} (${chunk.length} characters):`);
    console.log(chunk);
  });

  console.log(`\nAggregated text: ${graphTextOutput.data}`);

  cleanup(executor, outputStream);
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
