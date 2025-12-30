// Audio Configuration Constants
export const TTS_SAMPLE_RATE = 24000; // Sample rate for TTS output
export const INPUT_SAMPLE_RATE = 16000; // Sample rate for STT input (Assembly.AI)

// Server Configuration
export const WS_APP_PORT = 4000; // WebSocket server port

// LLM Model Configuration
export const DEFAULT_LLM_MODEL_NAME = process.env.LLM_MODEL_NAME || 'meta-llama/Llama-3.1-70b-Instruct';
export const DEFAULT_LLM_PROVIDER = process.env.LLM_PROVIDER || 'inworld';

// Voice and TTS Configuration
export const DEFAULT_VOICE_ID = process.env.VOICE_ID || 'Dennis';
export const DEFAULT_TTS_MODEL_ID = process.env.TTS_MODEL_ID || 'inworld-tts-1';

