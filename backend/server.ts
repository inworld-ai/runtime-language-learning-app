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
import { AnkiExporter } from './helpers/anki-exporter.js';
import {
  getLanguageConfig,
  getLanguageOptions,
  DEFAULT_LANGUAGE_CODE,
} from './config/languages.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Add JSON parsing middleware
app.use(express.json());

const PORT = process.env.PORT || 3000;

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
      appName: 'inworld-language-tutor',
      appVersion: '1.0.0',
    });

    telemetry.configureMetric({
      metricType: MetricType.CounterUInt,
      name: 'flashcard_clicks_total',
      description: 'Total flashcard clicks',
      unit: 'clicks',
    });
  } else {
    console.warn(
      '[Telemetry] INWORLD_API_KEY not set. Metrics will be disabled.'
    );
  }
} catch (err) {
  console.error('[Telemetry] Initialization failed:', err);
}

// ============================================================
// Initialize Graph
// ============================================================

async function initializeGraph(): Promise<void> {
  const assemblyAIApiKey = process.env.ASSEMBLY_AI_API_KEY;
  if (!assemblyAIApiKey) {
    throw new Error('ASSEMBLY_AI_API_KEY environment variable is required');
  }

  console.log('[Server] Creating conversation graph...');
  graphWrapper = ConversationGraphWrapper.create({
    assemblyAIApiKey,
    connections,
    defaultLanguageCode: DEFAULT_LANGUAGE_CODE,
  });
  console.log('[Server] Conversation graph created successfully');
}

// ============================================================
// WebSocket Connection Handler
// ============================================================

wss.on('connection', async (ws) => {
  if (!graphWrapper) {
    console.error('[Server] Graph not initialized, rejecting connection');
    ws.close(1011, 'Server not ready');
    return;
  }

  const connectionId = `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  console.log(`[Server] WebSocket connection established: ${connectionId}`);

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

  // Store processors
  connectionManagers.set(connectionId, connectionManager);
  flashcardProcessors.set(connectionId, flashcardProcessor);
  connectionAttributes.set(connectionId, { languageCode: defaultLanguageCode });

  // Set up flashcard generation callback
  connectionManager.setFlashcardCallback(async (messages) => {
    if (isShuttingDown) {
      console.log('[Server] Skipping flashcard generation - shutting down');
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
        console.error('[Server] Error generating flashcards:', error);
      }
    }
  });

  // Start the graph for this connection
  try {
    await connectionManager.start();
    console.log(`[Server] Graph started for connection ${connectionId}`);
  } catch (error) {
    console.error(`[Server] Failed to start graph for ${connectionId}:`, error);
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
        console.log(`[Server] Conversation restarted for ${connectionId}`);
      } else if (message.type === 'set_language') {
        // Handle language change
        const newLanguageCode = message.languageCode || DEFAULT_LANGUAGE_CODE;
        const attrs = connectionAttributes.get(connectionId) || {};

        if (attrs.languageCode !== newLanguageCode) {
          console.log(
            `[Server] Language change: ${attrs.languageCode} -> ${newLanguageCode}`
          );

          attrs.languageCode = newLanguageCode;
          connectionAttributes.set(connectionId, attrs);

          const languageConfig = getLanguageConfig(newLanguageCode);

          // Update all processors
          flashcardProcessors.get(connectionId)?.setLanguage(newLanguageCode);
          connectionManager.setLanguage(newLanguageCode);

          // Reset conversation on language change
          connectionManager.reset();
          flashcardProcessors.get(connectionId)?.reset();

          // Send confirmation
          ws.send(
            JSON.stringify({
              type: 'language_changed',
              languageCode: newLanguageCode,
              languageName: languageConfig.name,
              teacherName: languageConfig.teacherPersona.name,
            })
          );

          console.log(`[Server] Language changed to ${languageConfig.name}`);
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
        } catch (err) {
          console.error('[Server] Error recording flashcard click:', err);
        }
      } else if (message.type === 'text_message' && message.text) {
        // Handle text input (bypasses audio/STT)
        connectionManager.sendTextMessage(message.text);
      } else {
        console.log('[Server] Received message type:', message.type);
      }
    } catch (error) {
      console.error('[Server] Error processing message:', error);
    }
  });

  ws.on('error', (error) => {
    console.error(`[Server] WebSocket error for ${connectionId}:`, error);
  });

  ws.on('close', async () => {
    console.log(`[Server] WebSocket closed: ${connectionId}`);

    // Clean up connection manager
    const manager = connectionManagers.get(connectionId);
    if (manager) {
      try {
        await manager.destroy();
      } catch (error) {
        console.error(`[Server] Error destroying connection manager:`, error);
      }
      connectionManagers.delete(connectionId);
    }

    // Clean up other processors
    flashcardProcessors.delete(connectionId);
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
    console.error('[Server] Error exporting Anki deck:', error);
    res.status(500).json({ error: 'Failed to export Anki deck' });
  }
});

// Languages endpoint
app.get('/api/languages', (_req, res) => {
  try {
    const languages = getLanguageOptions();
    res.json({ languages, defaultLanguage: DEFAULT_LANGUAGE_CODE });
  } catch (error) {
    console.error('[Server] Error getting languages:', error);
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
    server.listen(PORT, () => {
      console.log(`[Server] Running on port ${PORT}`);
      console.log(`[Server] Using Inworld Runtime 0.9 with AssemblyAI STT`);
    });
  } catch (error) {
    console.error('[Server] Failed to start:', error);
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

  console.log('[Server] Shutting down gracefully...');

  try {
    // Close all WebSocket connections
    console.log(
      `[Server] Closing ${wss.clients.size} WebSocket connections...`
    );
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
      console.log('[Server] HTTP server closed');
    });

    stopInworldRuntime()
      .then(() => console.log('[Server] Inworld Runtime stopped'))
      .catch(() => {});

    console.log('[Server] Shutdown complete');
  } catch {
    // Ignore errors during shutdown
  }

  process.exitCode = 0;
  process.exit(0);
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
