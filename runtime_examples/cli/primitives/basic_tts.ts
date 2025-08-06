import 'dotenv/config';

import type { VoiceInterface } from '@inworld/runtime/common';
import { InworldError } from '@inworld/runtime/common';
import {
  SpeechSynthesisConfig,
  TTSFactory,
} from '@inworld/runtime/primitives/tts';
import * as fs from 'fs';
import * as path from 'path';

import { DEFAULT_VOICE_ID, SAMPLE_RATE } from '../constants';

const minimist = require('minimist');
const wavEncoder = require('wav-encoder');

const usage = `
Usage:
    yarn basic-tts "Hello, how are you?" \n
    --voiceName=<voice-id>[optional, ${DEFAULT_VOICE_ID} will be used by default]
    --languageCode=<language-code>[optional, e.g., en-US]`;

const OUTPUT_DIRECTORY = path.join(
  __dirname,
  '..',
  '..',
  'data-output',
  'tts_samples',
);
const OUTPUT_PATH = path.join(OUTPUT_DIRECTORY, 'basic_tts_output.wav');

run();

async function run() {
  const { text, voiceName, languageCode, apiKey } = parseArgs();

  // Create speech synthesis configuration
  const speechSynthesisConfig = SpeechSynthesisConfig.getDefault();

  const tts = await TTSFactory.createRemote({
    apiKey,
    synthesisConfig: {
      type: 'inworld',
      config: {
        model_id: 'inworld-tts-1-max',
        inference: {
          speaking_rate: 1.0,
          pitch: 0,
          temperature: 0.8,
        },
        postprocessing: {
          sample_rate: SAMPLE_RATE,
        },
      },
    },
  });

  if (languageCode) {
    // Use advanced synthesis with voice configuration and speech synthesis input
    const voiceConfig: VoiceInterface = {
      speakerId: voiceName,
      languageCode: languageCode,
    };

    console.log('Using voice configuration:', voiceConfig);
    console.log('Using speech synthesis text:', text);
    console.log('Using synthesis config type:', speechSynthesisConfig.type);

    const stream = await tts.synthesizeSpeech(voiceConfig, text);
    let allAudioData: number[] = [];
    let chunk = await stream.next();

    while (!chunk.done) {
      // Concatenate the audio data
      allAudioData = allAudioData.concat(Array.from(chunk.audio));
      chunk = await stream.next();
    }

    // Create a single audio object with all the data
    const audio = {
      sampleRate: SAMPLE_RATE, // default sample rate
      channelData: [new Float32Array(allAudioData)],
    };

    // Encode and write all the audio data to a single file
    const buffer = await wavEncoder.encode(audio);
    if (!fs.existsSync(OUTPUT_DIRECTORY)) {
      fs.mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
    }

    fs.writeFileSync(OUTPUT_PATH, Buffer.from(buffer));

    console.log(`Audio saved to ${OUTPUT_PATH}`);
    console.log(`Generated ${allAudioData.length} audio samples`);
  } else {
    // Use basic synthesis for backward compatibility
    const stream = await tts.synthesizeSpeech(voiceName, text);
    let allAudioData: number[] = [];
    let chunk = await stream.next();

    while (!chunk.done) {
      // Concatenate the audio data
      allAudioData = allAudioData.concat(Array.from(chunk.audio));
      chunk = await stream.next();
    }

    // Create a single audio object with all the data
    const audio = {
      sampleRate: SAMPLE_RATE, // default sample rate
      channelData: [new Float32Array(allAudioData)],
    };

    // Encode and write all the audio data to a single file
    const buffer = await wavEncoder.encode(audio);
    if (!fs.existsSync(OUTPUT_DIRECTORY)) {
      fs.mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
    }

    fs.writeFileSync(OUTPUT_PATH, Buffer.from(buffer));

    console.log(`Audio saved to ${OUTPUT_PATH}`);
  }

  tts.destroy();
}

function parseArgs(): {
  text: string;
  voiceName: string;
  languageCode?: string;
  configType?: 'inworld';
  apiKey: string;
} {
  const argv = minimist(process.argv.slice(2));

  if (argv.help) {
    console.log(usage);
    process.exit(0);
  }

  const text = argv._?.join(' ') || '';
  const voiceName = argv.voiceName || DEFAULT_VOICE_ID;
  const languageCode = argv.languageCode;
  const configType = argv.configType;
  const apiKey = process.env.INWORLD_API_KEY || '';

  if (!text) {
    throw new Error(`You need to provide text.\n${usage}`);
  }

  if (!apiKey) {
    throw new Error(
      `You need to set INWORLD_API_KEY environment variable.\n${usage}`,
    );
  }

  if (configType && !['inworld', 'elevenlabs'].includes(configType)) {
    throw new Error(
      `Invalid config type: ${configType}. Must be 'inworld' or 'elevenlabs'.\n${usage}`,
    );
  }

  return { text, voiceName, languageCode, configType, apiKey };
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
