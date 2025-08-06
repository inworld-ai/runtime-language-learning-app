import 'dotenv/config';

import { InworldError } from '@inworld/runtime/common';
import { DeviceRegistry, DeviceType } from '@inworld/runtime/core';
import { VADFactory } from '@inworld/runtime/primitives/vad';
import * as fs from 'fs';

import { DEFAULT_VAD_MODEL_PATH } from '../constants';

const minimist = require('minimist');
const WavDecoder = require('wav-decoder');

const usage = `
Usage:
    yarn basic-vad \n
    --audioFilePath=<path-to-audio-file>[required, expected to be wav format] \n
    --modelPath=<path-to-model>[optional, required for local mode]`;

run();

async function run() {
  const { audioFilePath, modelPath } = parseArgs();

  const audioData = await WavDecoder.decode(fs.readFileSync(audioFilePath));

  const found = DeviceRegistry.getAvailableDevices().find(
    (d) => d.getType() === DeviceType.CUDA,
  );

  let vad = await VADFactory.createLocal({ modelPath, device: found });

  const result = await vad.detectVoiceActivity({
    data: audioData.channelData[0],
    sampleRate: audioData.sampleRate,
  });

  vad.destroy();

  console.log('Result:', result);
}

function parseArgs(): {
  audioFilePath: string;
  modelPath: string;
  apiKey: string;
} {
  const argv = minimist(process.argv.slice(2));

  if (argv.help) {
    console.log(usage);
    process.exit(0);
  }

  const audioFilePath = argv.audioFilePath || '';
  const modelPath = argv.modelPath || DEFAULT_VAD_MODEL_PATH;
  const apiKey = process.env.INWORLD_API_KEY || '';

  if (!audioFilePath) {
    throw new Error(`You need to provide a audioFilePath.\n${usage}`);
  }

  if (!modelPath) {
    throw new Error(
      `You need to specify a model path for local mode.\n${usage}`,
    );
  }

  return { audioFilePath, apiKey, modelPath };
}

function done() {
  process.exit(0);
}

process.on('SIGINT', done);
process.on('SIGTERM', done);
process.on('SIGUSR2', done);
process.on('unhandledRejection', (err: Error) => {
  if (err instanceof InworldError) {
    console.error('Inworld Error: ', {
      message: err.message,
      context: err.context,
    });
  } else {
    console.error(err.message);
  }
  process.exit(1);
});
