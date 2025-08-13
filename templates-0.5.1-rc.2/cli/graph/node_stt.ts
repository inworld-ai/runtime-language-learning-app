import 'dotenv/config';

import * as fs from 'fs';
const WavDecoder = require('wav-decoder');

import {
  GraphBuilder,
  GraphTypes,
  RemoteSTTNode,
} from '@inworld/runtime/graph';

const minimist = require('minimist');

import { bindProcessHandlers } from '../helpers/cli_helpers';

const usage = `
Usage:
    yarn node-stt \n
    --audioFilePath=<path-to-audio-file>[required, expected to be wav format]`;

run();

async function run() {
  const { audioFilePath, apiKey } = parseArgs();

  const audioData = await WavDecoder.decode(fs.readFileSync(audioFilePath));
  const sttNode = new RemoteSTTNode();

  const graph = new GraphBuilder({
    id: 'node_stt_graph',
    apiKey,
    enableRemoteConfig: false,
  })
    .addNode(sttNode)
    .setStartNode(sttNode)
    .setEndNode(sttNode)
    .build();

  const outputStream = graph.start(
    new GraphTypes.Audio({
      data: Array.from(audioData.channelData[0] || []),
      sampleRate: audioData.sampleRate,
    }),
  );

  let result = '';
  let resultCount = 0;
  for await (const resp of outputStream) {
    await resp.processResponse({
      string: (text: string) => {
        result += text;
        resultCount++;
      },
      TextStream: async (textStream: any) => {
        for await (const chunk of textStream) {
          if (chunk.text) {
            result += chunk.text;
            resultCount++;
          }
        }
      },
      default: (data: any) => {
        if (typeof data === 'string') {
          result += data;
          resultCount++;
        } else {
          console.log('Unprocessed response:', data);
        }
      },
    });
  }

  console.log(`Result count: ${resultCount}`);
  console.log(`Result: ${result}`);
}

function parseArgs(): {
  audioFilePath: string;
  apiKey: string;
} {
  const argv = minimist(process.argv.slice(2));

  if (argv.help) {
    console.log(usage);
    process.exit(0);
  }

  const audioFilePath = argv.audioFilePath || '';
  const apiKey = process.env.INWORLD_API_KEY || '';

  if (!audioFilePath) {
    throw new Error(`You need to provide a audioFilePath.\n${usage}`);
  }

  return { audioFilePath, apiKey };
}

bindProcessHandlers();
