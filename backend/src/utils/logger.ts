/**
 * Structured Logging with Pino
 *
 * Provides a centralized logging system with:
 * - Log levels (trace, debug, info, warn, error, fatal)
 * - Structured JSON output in production
 * - Pretty-printed output in development
 * - Child loggers with context (module, sessionId)
 */

import pino from 'pino';

const isDevelopment = process.env.NODE_ENV !== 'production';

/**
 * Root logger instance
 * Configure LOG_LEVEL env var to change verbosity (default: 'info')
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

/**
 * Create a child logger for a specific module
 * @param module - Module name (e.g., 'Server', 'ConnectionManager')
 */
export function createLogger(module: string): pino.Logger {
  return logger.child({ module });
}

/**
 * Create a session-scoped logger with module and sessionId context
 * @param module - Module name
 * @param sessionId - Session/connection identifier
 */
export function createSessionLogger(
  module: string,
  sessionId: string
): pino.Logger {
  return logger.child({ module, sessionId });
}

// Pre-created module loggers for common components
export const serverLogger = createLogger('Server');
export const graphLogger = createLogger('Graph');
export const connectionLogger = createLogger('ConnectionManager');
export const flashcardLogger = createLogger('FlashcardProcessor');
export const feedbackLogger = createLogger('FeedbackProcessor');
