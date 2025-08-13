import { TextGenerationConfigInterface } from '@inworld/runtime/primitives/llm';

export enum Modes {
  LOCAL = 'local',
  REMOTE = 'remote',
}

export enum TTS_MODEL {
  INWORLD_TTS_1 = 'inworld-tts-1', // 1B
  INWORLD_TTS_1_MAX = 'inworld-tts-1-max', // 8B
}

export const DEFAULT_TTS_MODEL_ID = TTS_MODEL.INWORLD_TTS_1_MAX;
export const DEFAULT_VOICE_ID = 'Ashley';
export const DEFAULT_LLM_MODEL_NAME = 'gpt-4o-mini';
export const DEFAULT_LOCAL_LLM_MODEL_PATH = './data/models/llm/llama3_1b';
export const DEFAULT_EMBEDDER_MODEL_NAME = 'BAAI/bge-large-en-v1.5';
export const DEFAULT_EMBEDDER_PROVIDER = 'inworld';
export const DEFAULT_LLM_PROVIDER = 'openai';
export const SAMPLE_RATE = 48000;
export const DEFAULT_VAD_MODEL_PATH = '../models/silero_vad.onnx';
export const TEXT_CONFIG = {
  max_new_tokens: 2500,
  max_prompt_length: 100,
  repetition_penalty: 1,
  top_p: 1,
  temperature: 1,
  frequency_penalty: 0,
  presence_penalty: 0,
  stop_sequences: [] as string[],
};

export function convertTextConfigToInterface(
  config: typeof TEXT_CONFIG,
): TextGenerationConfigInterface {
  return {
    maxNewTokens: config.max_new_tokens,
    maxPromptLength: config.max_prompt_length,
    repetitionPenalty: config.repetition_penalty,
    topP: config.top_p,
    temperature: config.temperature,
    frequencyPenalty: config.frequency_penalty,
    presencePenalty: config.presence_penalty,
    stopSequences: config.stop_sequences,
  };
}

export const TEXT_CONFIG_SDK = convertTextConfigToInterface(TEXT_CONFIG);

export const SYNTHESIS_CONFIG = {
  type: 'inworld',
  config: {
    model_id: DEFAULT_TTS_MODEL_ID,
    postprocessing: {
      sample_rate: SAMPLE_RATE,
    },
    inference: {
      temperature: 0.8,
      pitch: 0.0,
      speaking_rate: 1.0,
    },
  },
};

export const INTENTS = [
  {
    name: 'greeting',
    phrases: [
      'Hello',
      'Hi there',
      'Hey',
      'Good morning',
      'Good afternoon',
      'Good evening',
    ],
  },
  {
    name: 'farewell',
    phrases: [
      'Goodbye',
      'Bye',
      'See you later',
      'Take care',
      'Have a good day',
    ],
  },
  {
    name: 'help',
    phrases: [
      'I need help',
      'Can you help me?',
      'Could you assist me?',
      'Help please',
      'Support needed',
    ],
  },
];

export const DEFAULT_TOP_K = 2;
export const DEFAULT_THRESHOLD = 0.5;
export const DEFAULT_KNOWLEDGE_QUERY = 'How often are the Olympics held?';
export const KNOWLEDGE_RECORDS = [
  'The Olympics are staged every four years.',
  'Our solar system includes the Sun, eight planets, five officially named dwarf planets, hundreds of moons, and thousands of asteroids and comets.',
  'Nightingales have an astonishingly rich repertoire, able to produce over 1000 different sounds, compared with just 340 by skylarks and about 100 by blackbirds.',
];

export const KNOWLEDGE_COMPILE_CONFIG = {
  parsing_config: {
    max_chars_per_chunk: 200,
    max_chunks_per_document: 100,
  },
} as any;

export const KNOWLEDGE_COMPILE_CONFIG_SDK = {
  parsingConfig: {
    maxCharsPerChunk: 200,
    maxChunksPerDocument: 100,
  },
} as any;

export const TOOLS = [
  {
    name: 'calculator',
    description: 'Evaluate a mathematical expression',
    properties: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'The mathematical expression to evaluate',
        },
      },
      required: ['expression'],
    },
  },
  {
    name: 'get_weather',
    description: 'Get the current weather in a location',
    properties: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'The city and state, e.g., San Francisco, CA',
        },
      },
      required: ['location'],
    },
  },
] as any;
