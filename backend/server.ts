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
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

import { serverConfig } from './config/server.js';
import { serverLogger as logger } from './utils/logger.js';

// Import services
import { initTelemetry } from './services/telemetry.js';
import { initializeGraph, exportGraphConfigs } from './services/graph-service.js';
import { setupWebSocketHandlers } from './services/websocket-handler.js';
import { apiRouter } from './services/api-routes.js';
import { createGracefulShutdown } from './services/shutdown.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Express and servers
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Middleware
app.use(express.json());
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
  })
);

// Initialize telemetry
initTelemetry();

// API routes
app.use('/api', apiRouter);
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Static files
const frontendPath = path.join(__dirname, '../../frontend');
const devFrontendPath = path.join(__dirname, '../frontend');
const staticPath = path.resolve(frontendPath);
const devStaticPath = path.resolve(devFrontendPath);
const finalStaticPath = existsSync(devStaticPath) ? devStaticPath : staticPath;
app.use(express.static(finalStaticPath));

// WebSocket handlers
setupWebSocketHandlers(wss);

// Server startup
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

// Graceful shutdown
const gracefulShutdown = createGracefulShutdown(server, wss);
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
