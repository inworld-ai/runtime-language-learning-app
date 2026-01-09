/**
 * Graceful Shutdown Service
 *
 * Handles cleanup of all resources during server shutdown.
 */

import { Server } from 'http';
import { WebSocketServer } from 'ws';
import { stopInworldRuntime } from '@inworld/runtime';

import { serverLogger as logger } from '../utils/logger.js';
import {
  connectionManagers,
  setShuttingDown,
  isShuttingDown,
} from './state.js';
import { destroyGraph } from './graph-service.js';

export function createGracefulShutdown(
  server: Server,
  wss: WebSocketServer
): () => Promise<void> {
  return async function gracefulShutdown(): Promise<void> {
    if (isShuttingDown()) return;
    setShuttingDown(true);

    logger.info('shutdown_initiated');

    try {
      // Close all WebSocket connections
      logger.info(
        { connectionCount: wss.clients.size },
        'closing_websocket_connections'
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
      await destroyGraph();

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
  };
}
