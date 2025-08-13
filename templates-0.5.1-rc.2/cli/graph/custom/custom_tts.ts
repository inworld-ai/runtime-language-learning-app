import 'dotenv/config';

import {
  CustomNode,
  GraphBuilder,
  GraphTypes,
  ProcessContext,
  RemoteLLMChatNode,
  RemoteTTSNode,
  TextChunkingNode,
} from '@inworld/runtime/graph';
import * as fs from 'fs';
import * as path from 'path';

const minimist = require('minimist');
const wavEncoder = require('wav-encoder');

import {
  DEFAULT_LLM_MODEL_NAME,
  DEFAULT_LLM_PROVIDER,
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

class NodeStart extends CustomNode {
  process(_context: ProcessContext, input: string): string {
    return input;
  }
}

interface GraphResponse {
  llmResult: string;
  audioPath: string;
}

class NodePromptBuilder extends CustomNode {
  process(_context: ProcessContext, input: string): GraphTypes.LLMChatRequest {
    return new GraphTypes.LLMChatRequest({
      messages: [
        {
          role: 'user',
          content: input,
        },
      ],
    });
  }
}

class TTSRequestBuilderNode extends CustomNode {
  process(
    context: ProcessContext,
    input: GraphTypes.TextStream,
  ): GraphTypes.TTSRequest {
    const voiceName = context.getConfig()?.properties?.voiceName as string;
    if (!voiceName) {
      throw new Error('voiceName not found in execution config');
    }

    return GraphTypes.TTSRequest.withStream(input, {
      speakerId: voiceName,
    });
  }
}

class NodeCustomStreamReader extends CustomNode {
  async process(
    _context: ProcessContext,
    input: GraphTypes.TTSOutputStream,
  ): Promise<GraphTypes.Custom<GraphResponse>> {
    let llmResult = '';
    let allAudioData: number[] = [];

    for await (const chunk of input) {
      if (chunk.text) llmResult += chunk.text;
      if (chunk.audio?.data) {
        allAudioData = allAudioData.concat(Array.from(chunk.audio.data));
      }
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
  }
}

const usage = `
Usage:
    yarn node-custom-tts "Hello, how are you?" \n
    --voiceName=<voice-id>[REQUIRED, dynamic override voice for custom node, e.g. "Erik"] \n
    --modelId=<model-id>[optional, ${DEFAULT_TTS_MODEL_ID} will be used by default] \n
    --defaultVoice=<voice-id>[optional, ${DEFAULT_VOICE_ID} will be used as default voice for TTS primitive]`;

run();

async function run() {
  const { text, modelId, defaultVoice, voiceName, apiKey } = parseArgs();

  // Create nodes
  const nodeStart = new NodeStart();
  const nodePromptBuilder = new NodePromptBuilder();
  const llmNode = new RemoteLLMChatNode({
    provider: DEFAULT_LLM_PROVIDER,
    modelName: DEFAULT_LLM_MODEL_NAME,
    stream: true,
  });
  const textChunkingNode = new TextChunkingNode();
  const ttsRequestBuilderNode = new TTSRequestBuilderNode({
    executionConfig: {
      voiceName: voiceName,
    },
  });
  const ttsNode = new RemoteTTSNode({
    speakerId: defaultVoice,
    modelId,
  });
  const customStreamReader = new NodeCustomStreamReader();

  // Build graph with method chaining
  const graph = new GraphBuilder({
    id: 'custom_tts_graph',
    apiKey,
    enableRemoteConfig: false,
  })
    .addNode(nodeStart)
    .addNode(nodePromptBuilder)
    .addNode(llmNode)
    .addNode(textChunkingNode)
    .addNode(ttsRequestBuilderNode)
    .addNode(ttsNode)
    .addNode(customStreamReader)
    .addEdge(nodeStart, nodePromptBuilder)
    .addEdge(nodePromptBuilder, llmNode)
    .addEdge(llmNode, textChunkingNode)
    .addEdge(textChunkingNode, ttsRequestBuilderNode)
    .addEdge(ttsRequestBuilderNode, ttsNode)
    .addEdge(ttsNode, customStreamReader)
    .setStartNode(nodeStart)
    .setEndNode(customStreamReader)
    .build();

  const outputStream = graph.start(text);

  let done = false;
  while (!done) {
    const result = await outputStream.next();

    await result.processResponse({
      ContentStream: async (contentStream) => {
        let llmResult = '';
        for await (const chunk of contentStream) {
          if (chunk.text) llmResult += chunk.text;
        }
        console.log('LLM report to client result:', llmResult);
      },
      Custom: (custom) => {
        console.log('Custom stream reader result:', custom);
      },
    });

    done = result.done;
  }
}

function parseArgs(): {
  text: string;
  modelId: string;
  defaultVoice: string;
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
  const defaultVoice = argv.defaultVoice || DEFAULT_VOICE_ID;
  const voiceName = argv.voiceName;
  const apiKey = process.env.INWORLD_API_KEY || '';

  if (!text) {
    throw new Error(`You need to provide text.\n${usage}`);
  }

  if (!voiceName) {
    throw new Error(`You need to provide --voiceName parameter.\n${usage}`);
  }

  console.log(`Using default voice: ${defaultVoice} for TTS primitive`);
  console.log(`Using override voice: ${voiceName} for custom node`);

  return { text, modelId, defaultVoice, voiceName, apiKey };
}

bindProcessHandlers();
