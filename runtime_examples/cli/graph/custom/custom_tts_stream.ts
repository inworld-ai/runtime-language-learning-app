import 'dotenv/config';

import {
  AudioResponse,
  ComponentFactory,
  CustomInputDataType,
  CustomOutputDataTypeTyped,
  GraphBuilder,
  NodeFactory,
  registerCustomNodeType,
} from '@inworld/runtime/graph';
import * as fs from 'fs';
import * as path from 'path';
import { v4 } from 'uuid';

import {
  DEFAULT_TTS_MODEL_ID,
  DEFAULT_VOICE_ID,
  SAMPLE_RATE,
} from '../../constants';
import { bindProcessHandlers, cleanup } from '../../helpers/cli_helpers';

const OUTPUT_DIRECTORY = path.join(
  __dirname,
  '..',
  '..',
  'data-output',
  'tts_samples',
);

const OUTPUT_PATH = path.join(OUTPUT_DIRECTORY, 'node_custom_tts_output.wav');

const minimist = require('minimist');
const wavEncoder = require('wav-encoder');

const customStreamReaderNodeType = registerCustomNodeType(
  'custom-stream-reader',
  [CustomInputDataType.TTS_STREAM],
  CustomOutputDataTypeTyped<{
    initialText: string;
    audio: string;
  }>(),
  async (_context, input) => {
    let initialText = '';
    let allAudioData: number[] = [];

    let chunk: AudioResponse = await input.next();

    while (!chunk.done) {
      initialText += chunk.text;
      allAudioData = allAudioData.concat(Array.from(chunk.audio.data));
      chunk = await input.next();
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

    return { initialText, audio: OUTPUT_PATH };
  },
);

const usage = `
Usage:
    yarn node-custom-tts-stream "Hello, how are you?" \n
    --modelId=<model-id>[optional, ${DEFAULT_TTS_MODEL_ID} will be used by default] \n
    --voiceName=<voice-id>[optional, ${DEFAULT_VOICE_ID} will be used by default]`;

run();

async function run() {
  const { text, modelId, voiceName, apiKey } = parseArgs();

  const ttsComponent = ComponentFactory.createRemoteTTSComponent({
    id: 'tts_component_id',
    apiKey,
    synthesisConfig: {
      type: 'inworld',
      config: {
        modelId,
        inference: {
          temperature: 0.8,
          pitch: 0.0,
          speakingRate: 1.0,
        },
        postprocessing: {
          sampleRate: SAMPLE_RATE,
          // trimSilence: true,
        },
      },
    },
  });

  const ttsNode = await NodeFactory.createRemoteTTSNode({
    id: v4(),
    ttsComponentId: 'tts_component_id',
    voice: {
      speakerId: voiceName,
      languageCode: 'en-US',
    },
  });

  const customNode = NodeFactory.createCustomNode(
    'custom-stream-reader-node',
    customStreamReaderNodeType,
  );
  const executor = new GraphBuilder('custom_tts_stream_graph')
    .addComponent(ttsComponent)
    .addNode(ttsNode)
    .addNode(customNode)
    .addEdge(ttsNode, customNode)
    .setStartNode(ttsNode)
    .setEndNode(customNode)
    .getExecutor();

  const outputStream = await executor.execute(text, v4());
  const result = (await outputStream.next()).data;
  const { initialText, audio } = result as unknown as {
    initialText: string;
    audio: string;
  };

  console.log(`TTS initial text: ${initialText}`);
  console.log(`TTS stream audio: ${audio}`);

  cleanup(executor, outputStream);
}

function parseArgs(): {
  text: string;
  modelId: string;
  voiceName: string;
  apiKey: string;
} {
  const argv = minimist(process.argv.slice(2));

  if (argv.help) {
    console.log(usage);
    process.exit(0);
  }

  const text = argv._?.join(' ') || '';
  const modelId = argv.modelId || DEFAULT_TTS_MODEL_ID;
  const voiceName = argv.voiceName || DEFAULT_VOICE_ID;
  const apiKey = process.env.INWORLD_API_KEY || '';

  if (!text) {
    throw new Error(`You need to provide text.\n${usage}`);
  }

  if (!apiKey) {
    throw new Error(
      `You need to set INWORLD_API_KEY environment variable.\n${usage}`,
    );
  }

  return { text, modelId, voiceName, apiKey };
}

bindProcessHandlers();
