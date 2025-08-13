import 'dotenv/config';

import {
  GraphBuilder,
  GraphTypes,
  TextAggregatorNode,
  TextChunkingNode,
} from '@inworld/runtime/graph';
import * as fs from 'fs';
import * as path from 'path';

import { bindProcessHandlers } from '../helpers/cli_helpers';

const minimist = require('minimist');

const usage = `
Usage:
    yarn node-text-chunking-and-aggregator "This is a long text that needs to be chunked. Use textChunking node." \n
    OR \n
    yarn node-text-chunking-and-aggregator --file=path/to/your/text/file.txt`;

run();

async function run() {
  const { text } = parseArgs();

  const textChunkingNode = new TextChunkingNode({
    reportToClient: true,
  });

  const textAggregatorNode = new TextAggregatorNode({
    reportToClient: true,
  });

  const graph = new GraphBuilder({
    id: 'node_text_chunking_and_aggregator_graph',
    apiKey: process.env.INWORLD_API_KEY || '',
    enableRemoteConfig: false,
  })
    .addNode(textChunkingNode)
    .addNode(textAggregatorNode)
    .setStartNode(textChunkingNode)
    .setEndNode(textAggregatorNode)
    .addEdge(textChunkingNode, textAggregatorNode)
    .build();

  const outputStream = graph.start(text);

  let chunkCount = 0;
  const chunks: string[] = [];
  let aggregated: string | undefined;

  for await (const response of outputStream) {
    await response.processResponse({
      TextStream: async (chunkingStream: GraphTypes.TextStream) => {
        for await (const chunk of chunkingStream) {
          if (chunk.text) {
            chunks.push(chunk.text);
            chunkCount++;
          }
        }
      },
      string: (textResult: string) => {
        aggregated = textResult;
      },
      default: (data) => {
        console.log('Unprocessed data:', data);
      },
    });
  }

  // Output results
  console.log(`Input text length: ${text.length} characters`);
  console.log(`Number of chunks: ${chunkCount}`);
  console.log('Chunks:');
  chunks.forEach((chunk, index) => {
    console.log(`\nChunk ${index + 1} (${chunk.length} characters):`);
    console.log(chunk);
  });
  if (aggregated) {
    console.log(`Aggregated text: ${aggregated}`);
  }

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
