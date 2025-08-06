import 'dotenv/config';

import { TextStreamIterator } from '@inworld/runtime/common';
import { GraphBuilder, NodeFactory } from '@inworld/runtime/graph';
import * as fs from 'fs';
import * as path from 'path';
import { v4 } from 'uuid';

import { bindProcessHandlers, cleanup } from '../helpers/cli_helpers';

const minimist = require('minimist');

const usage = `
Usage:
    yarn node-text-chunking-and-aggregator "This is a long text that needs to be chunked. Use textChunking node." \n
    OR \n
    yarn node-text-chunking-and-aggregator --file=path/to/your/text/file.txt`;

run();

async function run() {
  const { text } = parseArgs();

  const textChunkingNode = NodeFactory.createTextChunkingNode({
    id: 'text-chunking-node',
    reportToClient: true,
  });

  const textAggregatorNode = NodeFactory.createTextAggregatorNode({
    id: 'text-aggregator-node',
    reportToClient: true,
  });

  const executor = new GraphBuilder('node_text_chunking_and_aggregator_graph')
    .addNode(textChunkingNode)
    .addNode(textAggregatorNode)
    .setStartNode(textChunkingNode)
    .setEndNode(textAggregatorNode)
    .addEdge(textChunkingNode, textAggregatorNode)
    .getExecutor();

  const outputStream = await executor.execute(text, v4());

  const output = await outputStream.next();

  if (output.type === 'TEXT_STREAM') {
    const chunkingStream = output.data as TextStreamIterator;

    // Process the streaming chunks
    let chunk = await chunkingStream.next();
    let resultCount = 0;
    const chunks: string[] = [];

    while (!chunk.done) {
      chunks.push(chunk.text);
      resultCount++;
      chunk = await chunkingStream.next();
    }

    // Output results
    console.log(`Input text length: ${text.length} characters`);
    console.log(`Number of chunks: ${resultCount}`);
    console.log('Chunks:');
    chunks.forEach((chunk, index) => {
      console.log(`\nChunk ${index + 1} (${chunk.length} characters):`);
      console.log(chunk);
    });
  } else {
    console.log('Output:', output);
  }

  // TODO: programmatic graph with text_chunking_node and text_aggregator_node in sequence produces
  //  non-text stream result, which is inconsistent with declarative variant of the graph node_text_chunking_and_aggregator_config
  //  which is using the same set of nodes, edges, and configurations.
  try {
    const aggregationResult = (await outputStream.next()).data as string;
    console.log(`Aggregated text: ${aggregationResult}`);
  } catch (_) {}

  cleanup(executor, outputStream);
  console.log('Graph created successfully!');
  console.log('Cleaning up...');

  console.log('Test completed successfully!');
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
    // If no text is provided, use a sample text to demonstrate chunking
    text =
      argv._?.join(' ') ||
      'This is a sample sentence. Here is another one! And a third one? Finally, the last sentence.';
  }

  if (!text) {
    throw new Error(
      `You need to provide text to chunk or a file path.\n${usage}`,
    );
  }

  return { text };
}

bindProcessHandlers();
