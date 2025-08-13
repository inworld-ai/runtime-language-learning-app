export const DEFAULT_VOICE_ID = 'Dennis';
export const DEFAULT_LLM_MODEL_NAME = 'gpt-4o-mini';
export const DEFAULT_PROVIDER = 'openai';
export const DEFAULT_TTS_MODEL_ID = 'inworld-tts-1';
export const DEFAULT_VAD_MODEL_PATH = '../../models/silero_vad.onnx';
export const INPUT_SAMPLE_RATE = 16000;
export const TTS_SAMPLE_RATE = 24000;
export const PAUSE_DURATION_THRESHOLD_MS = 650;
export const MIN_SPEECH_DURATION_MS = 200;
export const FRAME_PER_BUFFER = 1024;
export const SPEECH_THRESHOLD = 0.5;
export const TEXT_CONFIG = {
  maxNewTokens: 100, // 75 words
  maxPromptLength: 1000,
  repetitionPenalty: 1,
  topP: 0.5,
  temperature: 0.1,
  frequencyPenalty: 0,
  presencePenalty: 0,
  stopSequences: ['\n\n'],
};

export const WS_APP_PORT = 4000;
