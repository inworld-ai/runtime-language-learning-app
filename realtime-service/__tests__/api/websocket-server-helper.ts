/**
 * WebSocket Server Helper
 * Manages the WebSocket server lifecycle for integration tests
 */

import { ChildProcess, spawn } from 'child_process';
import WebSocket from 'ws';

let serverProcess: ChildProcess | null = null;
let serverPort: number = 3001;

/**
 * Start the WebSocket server for testing
 */
export async function startTestServer(port: number = 3001): Promise<number> {
  if (serverProcess) {
    return serverPort;
  }

  serverPort = port;

  return new Promise((resolve, reject) => {
    // Start the server process from the src directory
    const srcDir = __dirname + '/../../src';
    serverProcess = spawn('npm', ['start'], {
      cwd: srcDir,
      env: {
        ...process.env,
        WS_APP_PORT: String(port),
        AUTH_TOKEN: '', // Disable auth for tests
        NODE_ENV: 'test',
      },
      stdio: 'ignore', // Ignore stdio to prevent blocking
      detached: true, // Detach so it doesn't block Jest
    });
    
    // Unref so the parent process can exit without waiting
    serverProcess.unref();

    // Wait for server to be ready by attempting to connect
    const startTime = Date.now();
    const maxWait = 15000; // 15 seconds
    
    const checkServer = async (): Promise<void> => {
      while (Date.now() - startTime < maxWait) {
        try {
          await waitForServerReady(port, 1);
          resolve(port);
          return;
        } catch (error) {
          // Server not ready yet, wait a bit
          await new Promise(r => setTimeout(r, 500));
        }
      }
      reject(new Error('Server startup timeout'));
    };
    
    checkServer().catch(reject);
  });
}

/**
 * Stop the WebSocket server
 */
export async function stopTestServer(): Promise<void> {
  if (!serverProcess) {
    return;
  }

  return new Promise((resolve) => {
    const process = serverProcess!;
    serverProcess = null;

    process.on('exit', () => {
      resolve();
    });

    process.kill('SIGTERM');

    // Force kill after 5 seconds
    setTimeout(() => {
      if (!process.killed) {
        process.kill('SIGKILL');
        resolve();
      }
    }, 5000);
  });
}

/**
 * Wait for server to be ready by attempting to connect
 */
export async function waitForServerReady(port: number, maxAttempts: number = 20): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${port}/session?key=test-health-check`);
        
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('Connection timeout'));
        }, 1000);

        ws.on('open', () => {
          clearTimeout(timeout);
          ws.close();
          resolve();
        });

        ws.on('error', () => {
          clearTimeout(timeout);
          reject(new Error('Connection failed'));
        });
      });

      // Server is ready
      return;
    } catch (error) {
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  throw new Error('Server failed to become ready');
}

/**
 * Get the current server port
 */
export function getServerPort(): number {
  return serverPort;
}

