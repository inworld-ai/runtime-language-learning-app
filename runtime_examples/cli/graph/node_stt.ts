import 'dotenv/config';

import * as fs from 'fs';
const WavDecoder = require('wav-decoder');

import {
  ComponentFactory,
  GraphBuilder,
  NodeFactory,
} from '@inworld/runtime/graph';
import { v4 } from 'uuid';

const minimist = require('minimist');

import { bindProcessHandlers, cleanup } from '../helpers/cli_helpers';

const usage = `
Usage:
    yarn node-stt \n
    --audioFilePath=<path-to-audio-file>[required, expected to be wav format]`;

run();

async function run() {
  const { audioFilePath, apiKey } = parseArgs();

  const audioData = await WavDecoder.decode(fs.readFileSync(audioFilePath));
  const sttComponent = ComponentFactory.createRemoteSTTComponent({
    id: 'stt_component',
    sttConfig: {
      apiKey: apiKey,
      defaultConfig: {},
    },
  });

  const sttNode = NodeFactory.createRemoteSTTNode({
    id: 'stt_node',
    sttComponentId: sttComponent.id,
  });

  const executor = new GraphBuilder('node_stt_graph')
    .addComponent(sttComponent)
    .addNode(sttNode)
    .setStartNode(sttNode)
    .setEndNode(sttNode)
    .getExecutor();

  const outputStream = await executor.execute(
    {
      data: audioData.channelData[0],
      sampleRate: audioData.sampleRate,
    },
    v4(),
  );

  let result = '';
  let resultCount = 0;
  let chunk = await outputStream.next();

  while (!chunk.done) {
    result += chunk.data;
    resultCount++;

    chunk = await outputStream.next();
  }

  console.log(`Result count: ${resultCount}`);
  console.log(`Result: ${result}`);

  cleanup(executor, outputStream);
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

  if (!apiKey) {
    throw new Error(
      `You need to set INWORLD_API_KEY environment variable.\n${usage}`,
    );
  }

  return { audioFilePath, apiKey };
}

bindProcessHandlers();
