/**
 * Language Learning Server - Inworld Runtime 0.9
 *
 * This server uses a long-running circular graph with AssemblyAI for VAD/STT.
 * Key components:
 * - ConversationGraphWrapper: The main graph that processes audio → STT → LLM → TTS
 * - ConnectionManager: Manages WebSocket connections and feeds audio to the graph
 * - FlashcardProcessor: Generates flashcards from conversations
 */

// Load environment variables FIRST
import dotenv from 'dotenv';
dotenv.config();
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Basic imports
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { telemetry, stopInworldRuntime } from '@inworld/runtime';
import { MetricType } from '@inworld/runtime/telemetry';

// Import new 0.9 components
import { ConversationGraphWrapper } from './graphs/conversation-graph.js';
import { ConnectionManager } from './helpers/connection-manager.js';
import { ConnectionsMap } from './types/index.js';

// Import existing components (still compatible)
import { FlashcardProcessor } from './helpers/flashcard-processor.js';
import { FeedbackProcessor } from './helpers/feedback-processor.js';
import { getFlashcardGraph } from './graphs/flashcard-graph.js';
import { getResponseFeedbackGraph } from './graphs/response-feedback-graph.js';
import { AnkiExporter } from './helpers/anki-exporter.js';
import {
  getLanguageConfig,
  getLanguageOptions,
  DEFAULT_LANGUAGE_CODE,
} from './config/languages.js';
import { serverConfig } from './config/server.js';
import { serverLogger as logger } from './utils/logger.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Add JSON parsing middleware
app.use(express.json());

// ============================================================
// Global State
// ============================================================

// Shared connections map (used by graph nodes)
const connections: ConnectionsMap = {};

// Graph wrapper (created once, shared across all connections)
let graphWrapper: ConversationGraphWrapper | null = null;

// Connection managers per WebSocket
const connectionManagers = new Map<string, ConnectionManager>();
const flashcardProcessors = new Map<string, FlashcardProcessor>();
const feedbackProcessors = new Map<string, FeedbackProcessor>();
const connectionAttributes = new Map<
  string,
  { timezone?: string; userId?: string; languageCode?: string }
>();

// Shutdown flag
let isShuttingDown = false;

// ============================================================
// Initialize Telemetry
// ============================================================

try {
  const telemetryApiKey = process.env.INWORLD_API_KEY;
  if (telemetryApiKey) {
    telemetry.init({
      apiKey: telemetryApiKey,
      appName: serverConfig.telemetry.appName,
      appVersion: serverConfig.telemetry.appVersion,
    });
    logger.debug('telemetry_initialized');
    logger.debug(`appName: ${serverConfig.telemetry.appName}`);

    telemetry.configureMetric({
      metricType: MetricType.CounterUInt,
      name: 'flashcard_clicks_total',
      description: 'Total flashcard clicks',
      unit: 'clicks',
    });
  } else {
    logger.warn('telemetry_disabled_no_api_key');
  }
} catch (error) {
  logger.error({ err: error }, 'telemetry_init_failed');
}

// ============================================================
// Initialize Graph
// ============================================================

async function initializeGraph(): Promise<void> {
  const assemblyAIApiKey = process.env.ASSEMBLY_AI_API_KEY;
  if (!assemblyAIApiKey) {
    throw new Error('ASSEMBLY_AI_API_KEY environment variable is required');
  }

  logger.info('creating_conversation_graph');
  graphWrapper = ConversationGraphWrapper.create({
    assemblyAIApiKey,
    connections,
    defaultLanguageCode: DEFAULT_LANGUAGE_CODE,
  });
  logger.info('conversation_graph_created');
}

async function exportGraphConfigs(): Promise<void> {
  const configDir = path.join(__dirname, 'graphs/configs');

  if (!existsSync(configDir)) {
    await mkdir(configDir, { recursive: true });
  }

  const graphs = [
    { id: 'flashcard-generation-graph', graph: getFlashcardGraph() },
    { id: 'response-feedback-graph', graph: getResponseFeedbackGraph() },
    ...(graphWrapper ? [{ id: 'lang-learning-conversation-graph', graph: graphWrapper.graph }] : []),
  ];

  for (const { id, graph } of graphs) {
    const filePath = path.join(configDir, `${id}.json`);
    await writeFile(filePath, graph.toJSON(), 'utf-8');
    logger.info({ graphId: id, path: filePath }, 'graph_config_exported');
  }
}

// ============================================================
// WebSocket Connection Handler
// ============================================================

wss.on('connection', async (ws) => {
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

  // Store processors
  connectionManagers.set(connectionId, connectionManager);
  flashcardProcessors.set(connectionId, flashcardProcessor);
  feedbackProcessors.set(connectionId, feedbackProcessor);
  connectionAttributes.set(connectionId, { languageCode: defaultLanguageCode });

  // Set up flashcard generation callback
  connectionManager.setFlashcardCallback(async (messages) => {
    if (isShuttingDown) {
      logger.debug({ connectionId }, 'skipping_flashcard_generation_shutting_down');
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
      if (!isShuttingDown) {
        logger.error({ err: error, connectionId }, 'flashcard_generation_error');
      }
    }
  });

  // Set up feedback generation callback
  connectionManager.setFeedbackCallback(async (messages, currentTranscript) => {
    if (isShuttingDown) {
      logger.debug({ connectionId }, 'skipping_feedback_generation_shutting_down');
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
      if (!isShuttingDown) {
        logger.error({ err: error, connectionId }, 'feedback_generation_error');
      }
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
      } else if (message.type === 'restart_conversation') {
        // Reset all state
        connectionManager.reset();
        flashcardProcessors.get(connectionId)?.reset();
        logger.info({ connectionId }, 'conversation_restarted');
      } else if (message.type === 'set_language') {
        // Handle language change
        const newLanguageCode = message.languageCode || DEFAULT_LANGUAGE_CODE;
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
          connectionManager.setLanguage(newLanguageCode);

          // Reset conversation on language change
          connectionManager.reset();
          flashcardProcessors.get(connectionId)?.reset();
          feedbackProcessors.get(connectionId)?.reset();

          // Send confirmation
          ws.send(
            JSON.stringify({
              type: 'language_changed',
              languageCode: newLanguageCode,
              languageName: languageConfig.name,
              teacherName: languageConfig.teacherPersona.name,
            })
          );

          logger.info({ connectionId, language: languageConfig.name }, 'language_changed');
        }
      } else if (message.type === 'user_context') {
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
      } else if (message.type === 'flashcard_clicked') {
        try {
          const card = message.card || {};
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
      } else if (message.type === 'text_message' && message.text) {
        // Handle text input (bypasses audio/STT)
        connectionManager.sendTextMessage(message.text);
      } else {
        logger.debug({ connectionId, messageType: message.type }, 'received_message');
      }
    } catch (error) {
      logger.error({ err: error, connectionId }, 'message_processing_error');
    }
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
        logger.error({ err: error, connectionId }, 'connection_manager_destroy_error');
      }
      connectionManagers.delete(connectionId);
    }

    // Clean up other processors
    flashcardProcessors.delete(connectionId);
    feedbackProcessors.delete(connectionId);
    connectionAttributes.delete(connectionId);
  });
});

// ============================================================
// API Endpoints
// ============================================================

// ANKI export endpoint
app.post('/api/export-anki', async (req, res) => {
  try {
    const { flashcards, deckName, languageCode } = req.body;

    if (!flashcards || !Array.isArray(flashcards) || flashcards.length === 0) {
      res.status(400).json({ error: 'No flashcards provided' });
      return;
    }

    const exporter = new AnkiExporter();
    const validCount = exporter.countValidFlashcards(flashcards);

    if (validCount === 0) {
      res.status(400).json({ error: 'No valid flashcards to export' });
      return;
    }

    const defaultDeckName = `Inworld Language Tutor ${languageCode || 'Language'} Cards`;
    const apkgBuffer = await exporter.exportFlashcards(
      flashcards,
      deckName || defaultDeckName
    );

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${(deckName || defaultDeckName).replace(/[^a-zA-Z0-9]/g, '_')}.apkg"`
    );
    res.send(apkgBuffer);
  } catch (error) {
    logger.error({ err: error }, 'anki_export_error');
    res.status(500).json({ error: 'Failed to export Anki deck' });
  }
});

// Languages endpoint
app.get('/api/languages', (_req, res) => {
  try {
    const languages = getLanguageOptions();
    res.json({ languages, defaultLanguage: DEFAULT_LANGUAGE_CODE });
  } catch (error) {
    logger.error({ err: error }, 'get_languages_error');
    res.status(500).json({ error: 'Failed to get languages' });
  }
});

// ============================================================
// Static Files
// ============================================================

const frontendPath = path.join(__dirname, '../../frontend');
const devFrontendPath = path.join(__dirname, '../frontend');
const staticPath = path.resolve(frontendPath);
const devStaticPath = path.resolve(devFrontendPath);
const finalStaticPath = existsSync(devStaticPath) ? devStaticPath : staticPath;
app.use(express.static(finalStaticPath));

// ============================================================
// Server Startup
// ============================================================

async function startServer(): Promise<void> {
  try {
    await initializeGraph();
    await exportGraphConfigs();
    server.listen(serverConfig.port, () => {
      logger.info({ port: serverConfig.port }, 'server_started');
      logger.info('using_inworld_runtime_0.9_with_assemblyai_stt');
    });
  } catch (error) {
    logger.fatal({ err: error }, 'server_start_failed');
    process.exit(1);
  }
}

startServer();

// ============================================================
// Graceful Shutdown
// ============================================================

async function gracefulShutdown(): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info('shutdown_initiated');

  try {
    // Close all WebSocket connections
    logger.info({ connectionCount: wss.clients.size }, 'closing_websocket_connections');
    wss.clients.forEach((ws) => {
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
        ws.close();
      }
    });

    wss.close();

    // Clean up connection managers
    for (const manager of connectionManagers.values()) {
      manager.destroy().catch(() => {});
    }

    // Clean up graph wrapper
    if (graphWrapper) {
      await graphWrapper.destroy();
    }

    server.close(() => {
      logger.info('http_server_closed');
    });

    stopInworldRuntime()
      .then(() => logger.info('inworld_runtime_stopped'))
      .catch(() => {});

    logger.info('shutdown_complete');
  } catch {
    // Ignore errors during shutdown
  }

  process.exitCode = 0;
  process.exit(0);
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
