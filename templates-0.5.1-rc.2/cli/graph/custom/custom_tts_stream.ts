import 'dotenv/config';

import {
  CustomNode,
  GraphBuilder,
  GraphTypes,
  ProcessContext,
  RemoteTTSComponent,
  RemoteTTSNode,
} from '@inworld/runtime/graph';
import * as fs from 'fs';
import * as path from 'path';
import { v4 } from 'uuid';

import {
  DEFAULT_TTS_MODEL_ID,
  DEFAULT_VOICE_ID,
  SAMPLE_RATE,
} from '../../constants';
import { bindProcessHandlers } from '../../helpers/cli_helpers';

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

class CustomStreamReaderNode extends CustomNode {
  async process(
    _context: ProcessContext,
    input: GraphTypes.TTSOutputStream,
  ): Promise<{ initialText: string; audio: string }> {
    let initialText = '';
    let allAudioData: number[] = [];

    for await (const chunk of input) {
      if (chunk.text) initialText += chunk.text;
      if (chunk.audio?.data) {
        allAudioData = allAudioData.concat(Array.from(chunk.audio.data));
      }
    }

    const audio = {
      sampleRate: SAMPLE_RATE,
      channelData: [new Float32Array(allAudioData)],
    };

    const buffer = await wavEncoder.encode(audio);
    if (!fs.existsSync(OUTPUT_DIRECTORY)) {
      fs.mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
    }

    fs.writeFileSync(OUTPUT_PATH, Buffer.from(buffer));

    return { initialText, audio: OUTPUT_PATH };
  }
}

const usage = `
Usage:
    yarn node-custom-tts-stream "Hello, how are you?" \n
    --modelId=<model-id>[optional, ${DEFAULT_TTS_MODEL_ID} will be used by default] \n
    --voiceName=<voice-id>[optional, ${DEFAULT_VOICE_ID} will be used by default]`;

run();

async function run() {
  const { text, modelId, voiceName, apiKey } = parseArgs();

  const ttsComponent = new RemoteTTSComponent({
    id: 'tts_component_id',
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
        },
      },
    },
  });

  const ttsNode = new RemoteTTSNode({
    id: v4(),
    ttsComponent,
    speakerId: voiceName,
    languageCode: 'en-US',
    modelId,
  });

  const customNode = new CustomStreamReaderNode();
  const graph = new GraphBuilder({
    id: 'custom_tts_stream_graph',
    apiKey,
    enableRemoteConfig: false,
  })
    .addComponent(ttsComponent)
    .addNode(ttsNode)
    .addNode(customNode)
    .addEdge(ttsNode, customNode)
    .setStartNode(ttsNode)
    .setEndNode(customNode)
    .build();

  const outputStream = graph.start(text);
  const result = await outputStream.next();
  result.processResponse({
    Custom: (data: any) => {
      const { initialText, audio } = data as {
        initialText: string;
        audio: string;
      };
      console.log(`TTS initial text: ${initialText}`);
      console.log(`TTS stream audio: ${audio}`);
    },
    default: (data) => {
      console.log('Unprocessed data:', data);
    },
  });
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
