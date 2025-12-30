import { stopInworldRuntime } from '@inworld/runtime';
import logger from '../logger';
import { InworldApp } from './app';
import { Connection } from '../types/index';

export interface AppConfig {
  graphId?: string;
  llmModelName?: string;
  llmProvider?: string;
  voiceId?: string;
  ttsModelId?: string;
  graphVisualizationEnabled?: boolean;
  assemblyAIApiKey?: string;
  useMocks?: boolean;
}

export interface InworldAppConfig extends AppConfig {
  sharedConnections?: { [sessionId: string]: Connection };
}

/**
 * Helper to merge string config values with fallback chain
 */
function getStringConfig(
  configValue: string | undefined,
  defaultValue: string | undefined,
  envVar?: string | undefined,
  fallback: string = '',
): string {
  return configValue || defaultValue || envVar || fallback;
}

/**
 * Helper to merge boolean config values with fallback chain
 * Uses nullish coalescing to preserve false values
 */
function getBooleanConfig(
  configValue: boolean | undefined,
  defaultValue: boolean | undefined,
  envVar: string | undefined,
  fallback: boolean,
): boolean {
  if (configValue !== undefined) return configValue;
  if (defaultValue !== undefined) return defaultValue;
  if (envVar !== undefined && envVar.trim() !== '') {
    return envVar.toLowerCase().trim() === 'true';
  }
  return fallback;
}

/**
 * InworldRuntimeAppManager manages a single InworldApp instance.
 * The graph supports multitenancy natively, so we only need one instance.
 */
export class InworldRuntimeAppManager {
  private app: InworldApp | null = null;
  private defaultConfig: Partial<AppConfig>;
  private initPromise: Promise<InworldApp> | null = null;

  // Shared connections map for all sessions
  private sharedConnections: { [sessionId: string]: Connection } = {};

  constructor(defaultConfig?: Partial<AppConfig>) {
    this.defaultConfig = defaultConfig || {};
  }

  /**
   * Get the singleton InworldApp instance, creating it if needed.
   * Uses lazy initialization with proper handling of concurrent calls.
   */
  async getApp(configOverrides?: Partial<AppConfig>): Promise<InworldApp> {
    // Return existing app if already initialized
    if (this.app) {
      return this.app;
    }

    // If initialization is in progress, wait for it
    if (this.initPromise) {
      return this.initPromise;
    }

    // Start initialization
    this.initPromise = this.createApp(configOverrides);

    try {
      this.app = await this.initPromise;
      return this.app;
    } finally {
      this.initPromise = null;
    }
  }

  private async createApp(configOverrides?: Partial<AppConfig>): Promise<InworldApp> {
    logger.info('Creating InworldApp instance');

    const finalConfig: InworldAppConfig = {
      graphId: getStringConfig(configOverrides?.graphId, this.defaultConfig.graphId, undefined),
      llmModelName: getStringConfig(configOverrides?.llmModelName, this.defaultConfig.llmModelName),
      llmProvider: getStringConfig(configOverrides?.llmProvider, this.defaultConfig.llmProvider),
      voiceId: getStringConfig(configOverrides?.voiceId, this.defaultConfig.voiceId),
      ttsModelId: getStringConfig(configOverrides?.ttsModelId, this.defaultConfig.ttsModelId),
      graphVisualizationEnabled: getBooleanConfig(configOverrides?.graphVisualizationEnabled, this.defaultConfig.graphVisualizationEnabled, process.env.GRAPH_VISUALIZATION_ENABLED, false),
      assemblyAIApiKey: getStringConfig(configOverrides?.assemblyAIApiKey, this.defaultConfig.assemblyAIApiKey, process.env.ASSEMBLYAI_API_KEY),
      useMocks: getBooleanConfig(configOverrides?.useMocks, this.defaultConfig.useMocks, process.env.USE_MOCKS, false),
      sharedConnections: this.sharedConnections,
    };

    // Validate required config
    if (!finalConfig.assemblyAIApiKey) {
      const error = new Error('Missing AssemblyAI API key');
      logger.error({ err: error }, 'Missing AssemblyAI API key');
      throw error;
    }

    const app = await InworldApp.create(finalConfig);
    logger.info('InworldApp initialized successfully');
    return app;
  }

  /**
   * Check if the app has been initialized
   */
  isInitialized(): boolean {
    return this.app !== null;
  }

  /**
   * Shutdown the app and clean up resources
   */
  async shutdown(): Promise<void> {
    if (this.app) {
      logger.info('Shutting down InworldApp');
      await this.app.shutdown();
      this.app = null;
    }

    // Stop the global Inworld runtime
    stopInworldRuntime();
  }
}
