/**
 * Maps eagerness levels to AssemblyAI turn detection settings
 * Based on AssemblyAI's recommended configurations for different use cases
 */

export interface AssemblyAITurnDetectionSettings {
  endOfTurnConfidenceThreshold: number;
  minEndOfTurnSilenceWhenConfident: number;
  maxTurnSilence: number;
  description: string;
}

/**
 * Get AssemblyAI turn detection settings for a given eagerness level
 * @param eagerness - The eagerness level ('low' | 'medium' | 'high')
 * @returns AssemblyAI turn detection settings including threshold values and description
 */
export function getAssemblyAISettingsForEagerness(
  eagerness: 'low' | 'medium' | 'high' = 'medium'
): AssemblyAITurnDetectionSettings {
  switch (eagerness) {
    case 'high': // Aggressive - VERY responsive
      return {
        endOfTurnConfidenceThreshold: 0.4,
        minEndOfTurnSilenceWhenConfident: 160,
        maxTurnSilence: 320,
        description:
          'Aggressive - VERY quick responses, ideal for rapid Q&A (Agent Assist, IVR)',
      };
    case 'medium': // Balanced (default) - optimized for voice-to-voice latency
      return {
        endOfTurnConfidenceThreshold: 0.5,
        minEndOfTurnSilenceWhenConfident: 300,
        maxTurnSilence: 900,
        description:
          'Balanced - Optimized for responsive voice-to-voice conversation',
      };
    case 'low': // Conservative - VERY patient
      return {
        endOfTurnConfidenceThreshold: 0.7,
        minEndOfTurnSilenceWhenConfident: 800,
        maxTurnSilence: 3000,
        description:
          'Conservative - VERY patient, allows long thinking pauses (Complex inquiries)',
      };
  }
}
