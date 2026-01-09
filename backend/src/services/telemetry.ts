/**
 * Telemetry Service
 *
 * Initializes and configures Inworld telemetry.
 */

import { telemetry } from '@inworld/runtime';
import { MetricType } from '@inworld/runtime/telemetry';
import { serverConfig } from '../config/server.js';
import { serverLogger as logger } from '../utils/logger.js';

export function initTelemetry(): void {
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
}
