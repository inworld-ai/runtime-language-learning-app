import 'dotenv/config';

import { InworldError } from '@inworld/runtime/common';
import { STTFactory } from '@inworld/runtime/primitives/stt';
import * as fs from 'fs';

import { Modes } from '../constants';

const minimist = require('minimist');
const WavDecoder = require('wav-decoder');

const usage = `
Usage:
    yarn basic-stt \n
    --mode=remote|local[optional, default=remote] \n
    --audioFilePath=<path-to-audio-file>[required, expected to be wav format] \n
    --modelPath=<path-to-model>[optional, required for local mode]`;

run();

async function run() {
  const { audioFilePath, mode, modelPath, apiKey } = parseArgs();

  const audioData = await WavDecoder.decode(fs.readFileSync(audioFilePath));

  let stt;

  if (mode === Modes.LOCAL) {
    stt = await STTFactory.createLocal({ modelPath });
  } else {
    stt = await STTFactory.createRemote({
      apiKey,
    });
  }

  const stream = await stt.recognizeSpeech({
    data: audioData.channelData[0],
    sampleRate: audioData.sampleRate,
  });

  let transcription = '';
  let chunk = await stream.next();

  while (!chunk.done) {
    transcription += chunk.text;
    chunk = await stream.next();
  }

  stt.destroy();

  console.log('Transcription:', transcription);
}

function parseArgs(): {
  audioFilePath: string;
  mode: Modes;
  modelPath: string;
  apiKey: string;
} {
  const argv = minimist(process.argv.slice(2));

  if (argv.help) {
    console.log(usage);
    process.exit(0);
  }

  const mode = argv.mode === Modes.LOCAL ? Modes.LOCAL : Modes.REMOTE;
  const audioFilePath = argv.audioFilePath || '';
  const modelPath = argv.modelPath || '';
  const apiKey = process.env.INWORLD_API_KEY || '';

  if (!audioFilePath) {
    throw new Error(`You need to provide a audioFilePath.\n${usage}`);
  }

  if (mode === Modes.REMOTE) {
    if (!apiKey) {
      throw new Error(
        `You need to set INWORLD_API_KEY environment variable.\n${usage}`,
      );
    }
  } else if (!modelPath) {
    throw new Error(
      `You need to specify a model path for local mode.\n${usage}`,
    );
  }

  return { audioFilePath, mode, apiKey, modelPath };
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
