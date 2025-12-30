import 'dotenv/config';

import {InworldError} from '@inworld/runtime/common';
import {initTelemetry} from '@inworld/runtime/telemetry';
import cors from 'cors';
import express from 'express';
import http from 'http';
import {createServer} from 'http';
import client from 'prom-client';
import {parse} from 'url';
import {RawData, WebSocketServer} from 'ws';

import {RealtimeMessageHandler} from './components/realtime/realtime_message_handler';
import {InworldRuntimeAppManager} from './components/runtime_app_manager';
import {WS_APP_PORT} from './config';
import {abortStream, parseEnvironmentVariables} from './helpers';
import {formatContext, formatError, formatSession, formatWorkspace} from './log-helpers';
import logger from './logger';

const METRICS_PORT = 9000;
const register = new client.Registry();
register.setDefaultLabels({app: 'realtime-service'});

// Enable collection of default metrics
client.collectDefaultMetrics({register});

const wsConnectionCounter = new client.Gauge({
  name: 'websocket_connections_total',
  help: 'Total number of active WebSocket connections',
  registers: [register],
});

const app = express();
const server = createServer(app);
const webSocket = new WebSocketServer({noServer: true});

const metricsApp = express();
const metricsServer = http.createServer(metricsApp);

app.use(cors());
app.use(express.json());
app.use(express.static('frontend'));

// InworldRuntimeAppManager manages a single graph instance
// The graph supports multitenancy natively via API key in execute method
const env = parseEnvironmentVariables();
const inworldRuntimeAppManager = new InworldRuntimeAppManager({
  llmModelName: env.llmModelName,
  llmProvider: env.llmProvider,
  voiceId: env.voiceId,
  ttsModelId: env.ttsModelId,
  graphVisualizationEnabled: env.graphVisualizationEnabled,
  assemblyAIApiKey: env.assemblyAIApiKey,
});

initTelemetry({
  apiKey: env.apiKey,
  appName: env.appName,
  appVersion: env.appVersion,
});

metricsApp.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (ex) {
    logger.error({error: ex}, `Error serving metrics${formatError(ex)}`);
    res.status(500).end('Internal Server Error');
  }
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

/**
 * Extracts the Inworld API key from the WebSocket protocol header.
 * The key is embedded in the sec-websocket-protocol header with a 'basic_'
 * prefix. This function removes the prefix and reconstructs any missing base64
 * padding.
 */
function extractInworldApiKey(headers: http.IncomingHttpHeaders): string|
    undefined {
  const wsProtocolHeader = headers['sec-websocket-protocol'] as string;
  if (!wsProtocolHeader) {
    return undefined;
  }

  // The protocol header may contain comma-separated values, look for basic_
  // prefix
  const protocols = wsProtocolHeader.split(',').map(p => p.trim());
  for (const protocol of protocols) {
    if (protocol.startsWith('basic_')) {
      let base64Key = protocol.substring(
          6);  // Remove 'basic_' prefix to get base64 credentials

      // Reconstruct missing padding = symbols (sender cuts trailing = symbols)
      // Base64 strings should be a multiple of 4 characters in length
      const paddingNeeded = (4 - (base64Key.length % 4)) % 4;
      if (paddingNeeded > 0) {
        base64Key += '='.repeat(paddingNeeded);
      }
      return base64Key;
    }
  }

  return undefined;
}

webSocket.on('connection', async (ws, request) => {
  wsConnectionCounter.inc(1);
  const workspaceId = (request.headers['workspace-id'] as string) ||
      process.env.WORKSPACE_ID || 'default';

  try {
    logger.info(
        {workspaceId},
        `WebSocket connection received ${formatWorkspace(workspaceId)}`);

    // Extract the Inworld API key from sec-websocket-protocol header
    const inworldApiKey = extractInworldApiKey(request.headers);

    const {query} = parse(request.url!, true);
    const sessionId = query.key?.toString();

    logger.info(
        {sessionId, workspaceId},
        `WebSocket connection established ${
            formatContext(sessionId, workspaceId)}`);

    if (!sessionId) {
      logger.error(
          {workspaceId},
          `WebSocket connection rejected ${
              formatWorkspace(workspaceId)}: no session key provided`);
      ws.close(1008, 'No session key provided');
      return;
    }

    // Get the singleton InworldApp instance
    const inworldApp = await inworldRuntimeAppManager.getApp();

    // Create session on-the-fly if it doesn't exist
    if (!inworldApp.connections?.[sessionId]) {
      logger.info(
          {sessionId, workspaceId},
          `Creating new session ${formatContext(sessionId, workspaceId)}`);
      // Create a minimal connection for realtime protocol
      // The session will be fully configured via session.update events
      inworldApp.connections[sessionId] = {
        workspaceId,
        state: {
          interactionId: '',  // Will be set by graph nodes
          messages: [],
          agent: null,
          userName: 'User',
        },
        apiKey: inworldApiKey || '',
        ws: null,
      };
    }

    inworldApp.connections[sessionId].ws =
        inworldApp.connections[sessionId].ws ?? ws;

    ws.on('error', (error) => {
      logger.error(
          {error, sessionId, workspaceId},
          `WebSocket error ${formatContext(sessionId, workspaceId)}${
              formatError(error)}`);
    });

    ws.on('close', async (code, reason) => {
      logger.info(
          {sessionId, workspaceId, code, reason: reason.toString()},
          `WebSocket closed ${formatContext(sessionId, workspaceId)} [code:${
              code}] [reason:${reason.toString()}]`);
      wsConnectionCounter.dec(1);

      const connection = inworldApp.connections[sessionId];
      if (connection) {
        // Step 1: Abort any active graph executions FIRST
        abortStream(
            connection.currentAudioExecutionStream, 'audio execution stream',
            sessionId, 'on close');
        connection.currentAudioExecutionStream = undefined;

        // Step 2: Clean up multimodal stream if it exists
        if (connection.multimodalStreamManager) {
          logger.info(
              {sessionId},
              `Ending multimodal stream ${
                  formatSession(sessionId)} due to WebSocket close`);
          connection.multimodalStreamManager.end();
          connection.multimodalStreamManager = undefined;
        }

        // Step 3: Clean up audio graph execution reference
        if (connection.currentAudioGraphExecution) {
          connection.currentAudioGraphExecution = undefined;
        }
      }

      // Clean up AssemblyAI STT session if it exists
      const assemblyAINode = inworldApp.graphWithAudioInput?.assemblyAINode;
      if (assemblyAINode) {
        try {
          await assemblyAINode.closeSession(sessionId);
        } catch (error) {
          logger.error(
              {error, sessionId, workspaceId},
              `Error during closing Assembly Session ${
                  formatContext(sessionId, workspaceId)}${formatError(error)}`);
        }
      }

      // Clean up connection
      inworldApp.removeSession(sessionId);
      logger.info(`[Session ${sessionId}] Session removed and resources cleaned up`);
    });

    // Use OpenAI Realtime API protocol
    const realtimeHandler = new RealtimeMessageHandler(
        inworldApp,
        sessionId,
        (data: any) => ws.send(JSON.stringify(data)),
    );

    // Initialize session and send session.created event
    logger.info(
        {sessionId, workspaceId},
        `Initializing realtime session ${
            formatContext(sessionId, workspaceId)}`);
    await realtimeHandler.initialize();
    logger.info(
        {sessionId, workspaceId},
        `Realtime session initialized successfully ${
            formatContext(sessionId, workspaceId)}`);

    ws.on('message', (data: RawData) => realtimeHandler.handleMessage(data));
  } catch (error) {
    logger.error(
        {error, workspaceId},
        `WebSocket connection error ${formatWorkspace(workspaceId)}${
            formatError(error)}`);
    ws.close(1011, 'Internal server error');
  }
});

server.on('upgrade', async (request, socket, head) => {
  const {pathname, query} = parse(request.url!, true);

  if (pathname === '/session') {
    const authToken = process.env.AUTH_TOKEN;

    // Validate token if configured
    if (authToken) {
      const providedToken = query?.token?.toString();

      if (!providedToken || providedToken !== authToken) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    webSocket.handleUpgrade(request, socket, head, (ws) => {
      webSocket.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

server.listen(WS_APP_PORT, () => {
  logger.info(
      {port: WS_APP_PORT},
      `Application Server listening on port ${WS_APP_PORT}`);
  logger.info('InworldApp will be created on first connection');
});

metricsServer.listen(METRICS_PORT, () => {
  logger.info(
      {port: METRICS_PORT}, `Metrics Server listening on port ${METRICS_PORT}`);
});

function done() {
  logger.info('Server is closing');

  // Handle the async shutdown properly
  inworldRuntimeAppManager.shutdown()
      .then(() => {
        metricsServer.close(() => {
          logger.info('Metrics server closed');
          process.exit(0);
        });
      })
      .catch((err) => {
        logger.error({error: err}, `Error during shutdown${formatError(err)}`);
        process.exit(1);
      });
}

process.on('SIGINT', done);
process.on('SIGTERM', done);
process.on('SIGUSR2', done);
process.on('unhandledRejection', (err: unknown) => {
  if (err instanceof InworldError) {
    logger.error(
        {
          message: err.message,
          context: err.context,
        },
        `Inworld Error - unhandled rejection${formatError(err)}`);
  } else {
    logger.error({error: err}, `Unhandled rejection${formatError(err)}`);
  }
  process.exit(1);
});
