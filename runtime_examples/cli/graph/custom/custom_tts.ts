import 'dotenv/config';

import { ContentStreamIterator } from '@inworld/runtime/common';
import {
  AudioResponse,
  ComponentFactory,
  CustomInputDataType,
  CustomInputDataTypeTyped,
  CustomOutputDataType,
  CustomOutputDataTypeTyped,
  GraphBuilder,
  GraphOutputStreamResponseType,
  NodeFactory,
  ProcessContext,
  registerCustomNodeType,
} from '@inworld/runtime/graph';
import * as fs from 'fs';
import * as path from 'path';
import { v4 } from 'uuid';

const minimist = require('minimist');
const wavEncoder = require('wav-encoder');

import {
  DEFAULT_LLM_MODEL_NAME,
  DEFAULT_TTS_MODEL_ID,
  DEFAULT_VOICE_ID,
  SAMPLE_RATE,
  TEXT_CONFIG,
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

const nodeStartType = registerCustomNodeType(
  'node-start',
  [CustomInputDataType.CUSTOM],
  CustomOutputDataType.CUSTOM,
  (context: ProcessContext, input) => {
    return input;
  },
);

const nodePromptBuilderType = registerCustomNodeType(
  'node-prompt-builder',
  [CustomInputDataType.TEXT],
  CustomOutputDataType.CHAT_REQUEST,
  (_context, input) => {
    return [
      {
        role: 'user',
        content: input,
      },
    ];
  },
);

const nodeVoiceNameType = registerCustomNodeType(
  'node-voice-name',
  [CustomInputDataTypeTyped<{ voiceName: string }>()],
  CustomOutputDataType.TEXT,
  (context: ProcessContext, inputs) => {
    return inputs.voiceName;
  },
);

const customStreamReaderType = registerCustomNodeType(
  'custom-stream-reader',
  [CustomInputDataType.TTS_STREAM],
  CustomOutputDataTypeTyped<{
    llmResult: string;
    audioPath: string;
  }>(),
  async (_context, input) => {
    let llmResult = '';
    let allAudioData: number[] = [];

    let chunk: AudioResponse = await input.next();

    while (!chunk.done) {
      llmResult += chunk.text;
      allAudioData = allAudioData.concat(Array.from(chunk.audio.data));
      chunk = await input.next();
    }

    // Create a single audio object with all the data
    const audio = {
      sampleRate: SAMPLE_RATE,
      channelData: [new Float32Array(allAudioData)],
    };

    // Encode and write all the audio data to a single file
    const buffer = await wavEncoder.encode(audio);
    if (!fs.existsSync(OUTPUT_DIRECTORY)) {
      fs.mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
    }

    fs.writeFileSync(OUTPUT_PATH, Buffer.from(buffer));

    return { llmResult, audioPath: OUTPUT_PATH };
  },
);

const usage = `
Usage:
    yarn node-custom-tts "Hello, how are you?" \n
    --modelId=<model-id>[optional, ${DEFAULT_TTS_MODEL_ID} will be used by default] \n
    --voiceName=<voice-id>[optional, ${DEFAULT_VOICE_ID} will be used by default]`;

run();

async function run() {
  const { text, modelId, voiceName, apiKey } = parseArgs();

  // Create components
  const llmComponent = ComponentFactory.createRemoteLLMComponent({
    id: 'llm_component_id',
    provider: 'inworld',
    apiKey,
    modelName: DEFAULT_LLM_MODEL_NAME,
    defaultConfig: TEXT_CONFIG,
  });

  const ttsComponent = ComponentFactory.createRemoteTTSComponent({
    id: 'tts_component_id',
    apiKey,
    synthesisConfig: {
      type: 'inworld',
      config: {
        modelId,
        inference: {
          temperature: 0.8,
          pitch: 0,
          speakingRate: 1.0,
        },
        postprocessing: {
          sampleRate: SAMPLE_RATE,
        },
      },
    },
  });

  // Create nodes
  const nodeStart = NodeFactory.createCustomNode('start-node', nodeStartType);

  const nodePromptBuilder = NodeFactory.createCustomNode(
    'prompt-builder-node',
    nodePromptBuilderType,
  );

  const nodeVoiceName = NodeFactory.createCustomNode(
    'voice-node',
    nodeVoiceNameType,
  );

  const llmNode = NodeFactory.createRemoteLLMChatNode({
    id: 'llm-node',
    llmConfig: {
      provider: 'inworld',
      modelName: DEFAULT_LLM_MODEL_NAME,
      apiKey,
      stream: true,
      reportToClient: true,
    },
  });

  const textChunkingNode = NodeFactory.createTextChunkingNode({
    id: 'text-chunking-node',
  });

  const ttsNode = await NodeFactory.createRemoteTTSNode({
    id: 'tts-node',
    ttsComponentId: 'tts_component_id',
    voice: {
      speakerId: voiceName,
      languageCode: 'en-US',
    },
  });

  const customStreamReader = NodeFactory.createCustomNode(
    'stream-reader-node',
    customStreamReaderType,
  );

  // Build graph with method chaining
  const executor = new GraphBuilder('custom_tts_graph')
    .addComponent(llmComponent)
    .addComponent(ttsComponent)
    .addNode(nodeStart)
    .addNode(nodePromptBuilder)
    .addNode(nodeVoiceName)
    .addNode(llmNode)
    .addNode(textChunkingNode)
    .addNode(ttsNode)
    .addNode(customStreamReader)
    .addEdge(nodeStart, nodePromptBuilder)
    .addEdge(nodeStart, nodeVoiceName)
    .addEdge(nodePromptBuilder, llmNode)
    .addEdge(llmNode, textChunkingNode)
    .addEdge(textChunkingNode, ttsNode)
    .addEdge(nodeVoiceName, ttsNode)
    .addEdge(ttsNode, customStreamReader)
    .setStartNode(nodeStart)
    .setEndNode(customStreamReader)
    .getExecutor();

  const outputStream = await executor.execute(
    {
      text,
      voiceName,
    },
    v4(),
  );

  let done = false;
  while (!done) {
    const result = await outputStream.next();
    switch (result.type) {
      case GraphOutputStreamResponseType.CONTENT_STREAM:
        const contentStream = result.data as ContentStreamIterator;
        let chunkDone = false;
        let llmResult = '';
        while (!chunkDone) {
          const chunk = await contentStream.next();
          llmResult += chunk.text;
          chunkDone = chunk.done;
        }
        console.log('>>> LLM report to client result:', llmResult);
        break;
      case GraphOutputStreamResponseType.CUSTOM:
        console.log('>>> Custom stream reader result:', result.data);
        break;
    }
    done = result.done;
  }

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
