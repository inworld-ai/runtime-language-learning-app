import pino from 'pino';

/**
 * Logger configuration for Google Cloud Logging compatibility
 * 
 * DEFAULT: JSON logs formatted for Cloud Logging (production-ready)
 * OPTIONAL: Pretty-print for local development
 * 
 * Each log entry is a single JSON object, preventing multi-line splits in Cloud Logging
 * 
 * Environment variables:
 * - REALTIME_LOG_LEVEL: 'debug', 'info', 'warn', 'error' (default: 'info')
 * - REALTIME_LOG_PRETTY: '1' to enable pretty logs locally (default: '0' = JSON)
 * 
 * Examples:
 *   npm start                              # JSON logs (default, cloud-ready)
 *   REALTIME_LOG_PRETTY=1 npm start        # Pretty logs (local dev)
 *   REALTIME_LOG_LEVEL=debug npm start     # JSON with debug level
 */
const usePretty = process.env.REALTIME_LOG_PRETTY === '1';

const logger = pino({
  level: process.env.REALTIME_LOG_LEVEL || 'info',

  // Use pretty print locally (unless LOG_PRETTY=0), JSON in production
  transport: usePretty ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss.l', // Include milliseconds for debugging
      ignore: 'pid,hostname,service,version',
      // Show message and structured fields in a compact format
      messageFormat: '{levelLabel} {msg}',
      // Show structured fields in compact single-line format
      singleLine: true,
      // Limit object depth to avoid huge logs
      depth: 3,
    }
  } : undefined,

  // Add common fields to all logs
  base: {
    service: 'realtime-service',
    version: process.env.APP_VERSION || 'unknown',
  },

  // Format timestamps for Cloud Logging
  timestamp: pino.stdTimeFunctions.isoTime,

  // Map Pino levels to Cloud Logging severity
  formatters: {
    level: (label: string) => {
      return { severity: label.toUpperCase() };
    },
  },

  // Serialize errors properly
  serializers: {
    error: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
});

export default logger;

