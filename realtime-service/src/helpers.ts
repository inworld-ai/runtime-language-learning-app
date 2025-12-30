import logger from './logger';
import { DEFAULT_LLM_MODEL_NAME, DEFAULT_LLM_PROVIDER, DEFAULT_VOICE_ID, DEFAULT_TTS_MODEL_ID } from './config';

export const parseEnvironmentVariables = () => {
  if (!process.env.INWORLD_API_KEY) {
    throw new Error('INWORLD_API_KEY env variable is required');
  }

  // Assembly.AI is now the only STT provider for audio input
  if (!process.env.ASSEMBLYAI_API_KEY) {
    throw new Error('ASSEMBLYAI_API_KEY env variable is required');
  }

  logger.info('STT Service: Assembly.AI (only supported provider)');

  return {
    apiKey: process.env.INWORLD_API_KEY,
    llmModelName: DEFAULT_LLM_MODEL_NAME,
    llmProvider: DEFAULT_LLM_PROVIDER,
    voiceId: DEFAULT_VOICE_ID,
    ttsModelId: DEFAULT_TTS_MODEL_ID,
    // Because the env variable is optional and it's a string, we need to convert it to a boolean safely
    graphVisualizationEnabled:
      (process.env.GRAPH_VISUALIZATION_ENABLED || '').toLowerCase().trim() ===
      'true',
    assemblyAIApiKey: process.env.ASSEMBLYAI_API_KEY,
    appName: process.env.APP_NAME || 'realtime-service',
    appVersion: process.env.APP_VERSION || '1.0.0',
  };
};

/**
 * Safely aborts a stream with proper error handling and logging.
 * Handles both regular streams with abort() method and ContentStreams with napiStream.
 * 
 * @param stream The stream to abort (must have an abort method or napiStream with abort method)
 * @param streamName Descriptive name for the stream (for logging)
 * @param sessionId Session ID associated with the stream (for logging)
 * @param context Optional context message for logging (e.g., 'on close', 'due to cancellation')
 */
export function abortStream(
  stream: any | undefined,
  streamName: string,
  sessionId: string,
  context: string = ''
): void {
  if (!stream) {
    return;
  }

  const logContext = context ? ` ${context}` : '';
  logger.debug({ sessionId }, `Aborting ${streamName}${logContext}`);

  try {
    if (typeof stream.abort === 'function') {
      stream.abort();
    } else if (stream.napiStream && typeof stream.napiStream.abort === 'function') {
      // ContentStream doesn't have an abort() method, but we can try to abort the underlying napiStream
      stream.napiStream.abort();
    }
  } catch (error) {
    logger.error({ error, sessionId }, `Error aborting ${streamName}`);
  }
}

