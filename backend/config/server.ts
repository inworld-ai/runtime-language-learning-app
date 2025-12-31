/**
 * Server Configuration
 *
 * Centralized configuration for server settings, audio processing, and external services.
 * Environment variables can override defaults where appropriate.
 */

export interface AssemblyAITurnDetectionSettings {
  endOfTurnConfidenceThreshold: number;
  minEndOfTurnSilenceWhenConfident: number;
  maxTurnSilence: number;
  description: string;
}

export type AssemblyAIEagerness = 'low' | 'medium' | 'high';

/**
 * AssemblyAI turn detection presets based on their documentation
 * @see https://www.assemblyai.com/docs/speech-to-text/universal-streaming/turn-detection
 */
const assemblyAIPresets: Record<AssemblyAIEagerness, AssemblyAITurnDetectionSettings> = {
  /**
   * Aggressive - Quick responses for rapid back-and-forth
   * Use cases: Agent Assist, IVR replacements, Retail/E-commerce, Telecom
   */
  high: {
    endOfTurnConfidenceThreshold: 0.4,
    minEndOfTurnSilenceWhenConfident: 160,
    maxTurnSilence: 400,
    description: 'Aggressive - Quick responses for rapid back-and-forth (IVR, order confirmations)',
  },

  /**
   * Balanced - Natural middle ground for most conversational turns
   * Use cases: Customer Support, Tech Support, Financial Services, Travel
   */
  medium: {
    endOfTurnConfidenceThreshold: 0.4,
    minEndOfTurnSilenceWhenConfident: 400,
    maxTurnSilence: 1280,
    description: 'Balanced - Natural middle ground for most conversational turns',
  },

  /**
   * Conservative - Patient, allows thinking pauses
   * Use cases: Healthcare, Mental Health, Sales, Legal, Language Learning
   */
  low: {
    endOfTurnConfidenceThreshold: 0.7,
    minEndOfTurnSilenceWhenConfident: 800,
    maxTurnSilence: 3600,
    description: 'Conservative - Patient, allows thinking pauses (Language Learning, Healthcare)',
  },
};

export const serverConfig = {
  /**
   * HTTP server port
   */
  port: Number(process.env.PORT) || 3000,

  /**
   * Audio processing settings
   */
  audio: {
    /** Input sample rate from microphone (Hz) */
    inputSampleRate: 16000,
    /** TTS output sample rate (Hz) - Inworld TTS standard */
    ttsSampleRate: 22050,
  },

  /**
   * AssemblyAI speech-to-text configuration
   */
  assemblyAI: {
    /** Turn detection eagerness level */
    eagerness: (process.env.ASSEMBLY_AI_EAGERNESS || 'medium') as AssemblyAIEagerness,
    /** Format turns in output (typically false for real-time processing) */
    formatTurns: false,
  },

  /**
   * Telemetry configuration for Inworld Runtime
   */
  telemetry: {
    appName: 'inworld-language-tutor',
    appVersion: '1.0.0',
  },
} as const;

/**
 * Get AssemblyAI turn detection settings for the configured eagerness level
 */
export function getAssemblyAISettings(): AssemblyAITurnDetectionSettings {
  return assemblyAIPresets[serverConfig.assemblyAI.eagerness];
}

/**
 * Get AssemblyAI turn detection settings for a specific eagerness level
 * @param eagerness - The eagerness level ('low' | 'medium' | 'high')
 */
export function getAssemblyAISettingsForEagerness(
  eagerness: AssemblyAIEagerness
): AssemblyAITurnDetectionSettings {
  return assemblyAIPresets[eagerness];
}
