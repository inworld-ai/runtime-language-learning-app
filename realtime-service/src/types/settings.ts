/**
 * Maps OpenAI eagerness levels to AssemblyAI turn detection settings
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
        description: 'Aggressive - VERY quick responses, ideal for rapid Q&A (Agent Assist, IVR)',
      };
    case 'medium': // Balanced (default)
      return {
        endOfTurnConfidenceThreshold: 0.4,
        minEndOfTurnSilenceWhenConfident: 400,
        maxTurnSilence: 1280,
        description: 'Balanced - Natural conversation flow (Customer Support, Tech Support)',
      };
    case 'low': // Conservative - VERY patient
      return {
        endOfTurnConfidenceThreshold: 0.7,
        minEndOfTurnSilenceWhenConfident: 800,
        maxTurnSilence: 3000,
        description: 'Conservative - VERY patient, allows long thinking pauses (Complex inquiries)',
      };
  }
}

