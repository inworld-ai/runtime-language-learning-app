/**
 * WebSocket Handler
 *
 * Manages WebSocket connections and message processing.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { telemetry } from '@inworld/runtime';
import { GraphTypes } from '@inworld/runtime/graph';

import { ConnectionManager } from '../helpers/connection-manager.js';
import { FlashcardProcessor } from '../helpers/flashcard-processor.js';
import { FeedbackProcessor } from '../helpers/feedback-processor.js';
import { MemoryProcessor } from '../helpers/memory-processor.js';
import {
  getLanguageConfig,
  getSupportedLanguageCodes,
  DEFAULT_LANGUAGE_CODE,
} from '../config/languages.js';
import { serverLogger as logger } from '../utils/logger.js';
import { getSimpleTTSGraph } from '../graphs/simple-tts-graph.js';
import { serverConfig } from '../config/server.js';

import {
  connections,
  connectionManagers,
  flashcardProcessors,
  feedbackProcessors,
  memoryProcessors,
  connectionAttributes,
  isShuttingDown,
} from './state.js';
import { getGraphWrapper } from './graph-service.js';

export function setupWebSocketHandlers(wss: WebSocketServer): void {
  wss.on('connection', async (ws: WebSocket) => {
    const graphWrapper = getGraphWrapper();
    if (!graphWrapper) {
      logger.error('graph_not_initialized_rejecting_connection');
      ws.close(1011, 'Server not ready');
      return;
    }

    const connectionId = `conn_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    logger.info({ connectionId }, 'websocket_connected');

    // Default language is Spanish
    const defaultLanguageCode = DEFAULT_LANGUAGE_CODE;

    // Create connection manager (replaces AudioProcessor)
    const connectionManager = new ConnectionManager(
      connectionId,
      ws,
      graphWrapper,
      connections,
      defaultLanguageCode
    );

    // Create flashcard processor
    const flashcardProcessor = new FlashcardProcessor(defaultLanguageCode);

    // Create feedback processor
    const feedbackProcessor = new FeedbackProcessor(defaultLanguageCode);

    // Create memory processor
    const memoryProcessor = new MemoryProcessor(defaultLanguageCode);

    // Store processors
    connectionManagers.set(connectionId, connectionManager);
    flashcardProcessors.set(connectionId, flashcardProcessor);
    feedbackProcessors.set(connectionId, feedbackProcessor);
    memoryProcessors.set(connectionId, memoryProcessor);
    connectionAttributes.set(connectionId, {
      languageCode: defaultLanguageCode,
    });

    // Set up flashcard generation callback
    connectionManager.setFlashcardCallback(async (messages) => {
      if (isShuttingDown()) {
        logger.debug(
          { connectionId },
          'skipping_flashcard_generation_shutting_down'
        );
        return;
      }

      try {
        const attrs = connectionAttributes.get(connectionId) || {};
        const userAttributes: Record<string, string> = {
          timezone: attrs.timezone || '',
        };

        const targetingKey = attrs.userId || connectionId;
        const userContext = {
          attributes: userAttributes,
          targetingKey,
        };

        const flashcards = await flashcardProcessor.generateFlashcards(
          messages,
          1,
          userContext
        );
        if (flashcards.length > 0) {
          ws.send(
            JSON.stringify({
              type: 'flashcards_generated',
              flashcards,
            })
          );
        }
      } catch (error) {
        if (!isShuttingDown()) {
          logger.error(
            { err: error, connectionId },
            'flashcard_generation_error'
          );
        }
      }
    });

    // Set up feedback generation callback
    connectionManager.setFeedbackCallback(
      async (messages, currentTranscript) => {
        if (isShuttingDown()) {
          logger.debug(
            { connectionId },
            'skipping_feedback_generation_shutting_down'
          );
          return;
        }

        try {
          const attrs = connectionAttributes.get(connectionId) || {};
          const userAttributes: Record<string, string> = {
            timezone: attrs.timezone || '',
          };

          const targetingKey = attrs.userId || connectionId;
          const userContext = {
            attributes: userAttributes,
            targetingKey,
          };

          const feedback = await feedbackProcessor.generateFeedback(
            messages,
            currentTranscript,
            userContext
          );

          if (feedback) {
            ws.send(
              JSON.stringify({
                type: 'feedback_generated',
                messageContent: currentTranscript,
                feedback,
              })
            );
          }
        } catch (error) {
          if (!isShuttingDown()) {
            logger.error(
              { err: error, connectionId },
              'feedback_generation_error'
            );
          }
        }
      }
    );

    // Set up memory generation callback (fire-and-forget)
    connectionManager.setMemoryCallback((messages) => {
      if (isShuttingDown()) {
        return;
      }

      const attrs = connectionAttributes.get(connectionId) || {};
      const userId = attrs.userId;

      if (!userId) {
        // Can't create memories without a user ID
        return;
      }

      // Increment turn and check if we should create a memory
      memoryProcessor.incrementTurn();

      if (memoryProcessor.shouldCreateMemory()) {
        // Fire and forget - createMemoryAsync handles errors internally
        memoryProcessor.createMemoryAsync(userId, messages);
      }
    });

    // Start the graph for this connection
    try {
      await connectionManager.start();
      logger.info({ connectionId }, 'graph_started');
    } catch (error) {
      logger.error({ err: error, connectionId }, 'graph_start_failed');
      ws.close(1011, 'Failed to start audio processing');
      return;
    }

    // Handle incoming messages
    ws.on('message', (data) => {
      handleMessage(connectionId, ws, connectionManager, data);
    });

    ws.on('error', (error) => {
      logger.error({ err: error, connectionId }, 'websocket_error');
    });

    ws.on('close', async () => {
      logger.info({ connectionId }, 'websocket_closed');

      // Clean up connection manager
      const manager = connectionManagers.get(connectionId);
      if (manager) {
        try {
          await manager.destroy();
        } catch (error) {
          logger.error(
            { err: error, connectionId },
            'connection_manager_destroy_error'
          );
        }
        connectionManagers.delete(connectionId);
      }

      // Clean up other processors
      flashcardProcessors.delete(connectionId);
      feedbackProcessors.delete(connectionId);
      memoryProcessors.delete(connectionId);
      connectionAttributes.delete(connectionId);
    });
  });
}

function handleMessage(
  connectionId: string,
  ws: WebSocket,
  connectionManager: ConnectionManager,
  data: Buffer | ArrayBuffer | Buffer[]
): void {
  try {
    const message = JSON.parse(data.toString());

    if (message.type === 'audio_chunk' && message.audio_data) {
      // Process audio chunk
      connectionManager.addAudioChunk(message.audio_data);
    } else if (message.type === 'reset_flashcards') {
      const processor = flashcardProcessors.get(connectionId);
      if (processor) {
        processor.reset();
      }
    } else if (message.type === 'conversation_context_reset') {
      // Reset backend state when switching conversations
      connectionManager.reset();
      flashcardProcessors.get(connectionId)?.reset();
      logger.info({ connectionId }, 'conversation_context_reset');
    } else if (message.type === 'set_language') {
      handleLanguageChange(connectionId, ws, connectionManager, message);
    } else if (message.type === 'user_context') {
      handleUserContext(connectionId, message);
    } else if (message.type === 'flashcard_clicked') {
      handleFlashcardClicked(connectionId, message);
    } else if (message.type === 'text_message') {
      handleTextMessage(connectionId, ws, connectionManager, message);
    } else if (message.type === 'tts_pronounce_request') {
      handleTTSPronounce(connectionId, ws, message);
    } else {
      logger.debug(
        { connectionId, messageType: message.type },
        'received_message'
      );
    }
  } catch (error) {
    logger.error({ err: error, connectionId }, 'message_processing_error');
  }
}

function handleLanguageChange(
  connectionId: string,
  ws: WebSocket,
  connectionManager: ConnectionManager,
  message: { languageCode?: string }
): void {
  const requestedCode = message.languageCode;
  const supportedCodes = getSupportedLanguageCodes();

  let newLanguageCode = DEFAULT_LANGUAGE_CODE;
  if (requestedCode && supportedCodes.includes(requestedCode)) {
    newLanguageCode = requestedCode;
  } else if (requestedCode) {
    logger.warn(
      {
        connectionId,
        invalidCode: requestedCode,
        fallback: DEFAULT_LANGUAGE_CODE,
      },
      'invalid_language_code_using_default'
    );
  }

  const attrs = connectionAttributes.get(connectionId) || {};

  if (attrs.languageCode !== newLanguageCode) {
    logger.info(
      { connectionId, from: attrs.languageCode, to: newLanguageCode },
      'language_change'
    );

    attrs.languageCode = newLanguageCode;
    connectionAttributes.set(connectionId, attrs);

    const languageConfig = getLanguageConfig(newLanguageCode);

    // Update all processors
    flashcardProcessors.get(connectionId)?.setLanguage(newLanguageCode);
    feedbackProcessors.get(connectionId)?.setLanguage(newLanguageCode);
    memoryProcessors.get(connectionId)?.setLanguage(newLanguageCode);
    connectionManager.setLanguage(newLanguageCode);

    // Reset conversation on language change
    connectionManager.reset();
    flashcardProcessors.get(connectionId)?.reset();
    feedbackProcessors.get(connectionId)?.reset();
    memoryProcessors.get(connectionId)?.reset();

    // Send confirmation
    ws.send(
      JSON.stringify({
        type: 'language_changed',
        languageCode: newLanguageCode,
        languageName: languageConfig.name,
        teacherName: languageConfig.teacherPersona.name,
      })
    );

    logger.info(
      { connectionId, language: languageConfig.name },
      'language_changed'
    );
  }
}

function handleUserContext(
  connectionId: string,
  message: {
    timezone?: string;
    userId?: string;
    languageCode?: string;
    data?: { timezone?: string; userId?: string; languageCode?: string };
  }
): void {
  const timezone = message.timezone || message.data?.timezone;
  const userId = message.userId || message.data?.userId;
  const languageCode = message.languageCode || message.data?.languageCode;
  const currentAttrs = connectionAttributes.get(connectionId) || {};
  connectionAttributes.set(connectionId, {
    ...currentAttrs,
    timezone: timezone || currentAttrs.timezone,
    userId: userId || currentAttrs.userId,
    languageCode: languageCode || currentAttrs.languageCode,
  });

  // Set user ID on connection manager for memory retrieval
  if (userId) {
    const manager = connectionManagers.get(connectionId);
    if (manager) {
      manager.setUserId(userId);
    }
  }
}

function handleFlashcardClicked(
  connectionId: string,
  message: {
    card?: {
      id?: string;
      targetWord?: string;
      spanish?: string;
      word?: string;
      english?: string;
      translation?: string;
    };
  }
): void {
  const card = message.card;
  if (!card || typeof card !== 'object') {
    logger.debug({ connectionId }, 'flashcard_clicked_missing_card_data');
    return;
  }
  try {
    const attrs = connectionAttributes.get(connectionId) || {};
    telemetry.metric.recordCounterUInt('flashcard_clicks_total', 1, {
      connectionId,
      cardId: card.id || '',
      targetWord: card.targetWord || card.spanish || card.word || '',
      english: card.english || card.translation || '',
      source: 'ui',
      timezone: attrs.timezone || '',
      languageCode: attrs.languageCode || DEFAULT_LANGUAGE_CODE,
    });
  } catch (error) {
    logger.error({ err: error, connectionId }, 'flashcard_click_record_error');
  }
}

function handleTextMessage(
  connectionId: string,
  ws: WebSocket,
  connectionManager: ConnectionManager,
  message: { text?: string }
): void {
  const text = message.text;
  if (typeof text !== 'string' || text.trim().length === 0) {
    logger.debug({ connectionId }, 'empty_or_invalid_text_message_ignored');
    return;
  }
  if (text.length > 200) {
    logger.warn({ connectionId, length: text.length }, 'text_message_too_long');
    ws.send(
      JSON.stringify({
        type: 'error',
        message: 'Text message too long (max 200 chars)',
      })
    );
    return;
  }
  connectionManager.sendTextMessage(text.trim());
}

/**
 * Convert audio data to base64 string for WebSocket transmission
 * Inworld TTS returns Float32 PCM in [-1.0, 1.0] range
 */
function convertAudioToBase64(audio: {
  data?: string | number[] | Float32Array;
  sampleRate?: number;
}): { base64: string; format: 'float32' | 'int16' } | null {
  if (!audio.data) return null;

  if (typeof audio.data === 'string') {
    // Already base64 - assume Int16 format for backwards compatibility
    return { base64: audio.data, format: 'int16' };
  }

  // Inworld SDK returns audio.data as an array of raw bytes (0-255)
  // These bytes ARE the Float32 PCM data in IEEE 754 format (4 bytes per sample)
  const audioBuffer = Array.isArray(audio.data)
    ? Buffer.from(audio.data)
    : Buffer.from(
        audio.data.buffer,
        audio.data.byteOffset,
        audio.data.byteLength
      );

  return {
    base64: audioBuffer.toString('base64'),
    format: 'float32',
  };
}

async function handleTTSPronounce(
  connectionId: string,
  ws: WebSocket,
  message: { text?: string; languageCode?: string }
): Promise<void> {
  const text = message.text;
  const languageCode = message.languageCode || DEFAULT_LANGUAGE_CODE;

  if (typeof text !== 'string' || text.trim().length === 0) {
    ws.send(
      JSON.stringify({ type: 'tts_pronounce_error', error: 'Empty text' })
    );
    return;
  }

  if (text.length > 100) {
    logger.warn(
      { connectionId, length: text.length },
      'tts_pronounce_text_too_long'
    );
    ws.send(
      JSON.stringify({ type: 'tts_pronounce_error', error: 'Text too long' })
    );
    return;
  }

  try {
    const graph = getSimpleTTSGraph(languageCode);
    const executionResult = await graph.start({ text: text.trim() });

    for await (const res of executionResult.outputStream) {
      if ('processResponse' in res) {
        const resultWithProcess = res as {
          processResponse: (
            handlers: Record<string, (data: unknown) => Promise<void> | void>
          ) => Promise<void>;
        };
        await resultWithProcess.processResponse({
          TTSOutputStream: async (ttsData: unknown) => {
            const ttsStream = ttsData as GraphTypes.TTSOutputStream;
            for await (const chunk of ttsStream) {
              if (chunk.audio?.data) {
                const audioResult = convertAudioToBase64(chunk.audio);
                if (audioResult) {
                  ws.send(
                    JSON.stringify({
                      type: 'tts_pronounce_audio',
                      audio: audioResult.base64,
                      audioFormat: audioResult.format,
                      sampleRate:
                        chunk.audio.sampleRate ||
                        serverConfig.audio.ttsSampleRate,
                    })
                  );
                }
              }
            }
          },
        });
      }
    }

    ws.send(JSON.stringify({ type: 'tts_pronounce_complete' }));
  } catch (error) {
    logger.error({ err: error, connectionId }, 'tts_pronounce_error');
    ws.send(
      JSON.stringify({ type: 'tts_pronounce_error', error: 'TTS failed' })
    );
  }
}
