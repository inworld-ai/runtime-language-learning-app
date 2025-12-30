/**
 * Maps eagerness levels to AssemblyAI turn detection settings
 * Based on AssemblyAI's recommended configurations for different use cases
 *
 * @see https://www.assemblyai.com/docs/speech-to-text/universal-streaming/turn-detection
 */

export interface AssemblyAITurnDetectionSettings {
  endOfTurnConfidenceThreshold: number;
  minEndOfTurnSilenceWhenConfident: number;
  maxTurnSilence: number;
  description: string;
}

/**
 * Get AssemblyAI turn detection settings for a given eagerness level
 *
 * AssemblyAI's turn detection model uses:
 * - Semantic detection: Neural network predicts when speech naturally ends
 * - Acoustic detection: Traditional silence-based detection as backup (VAD)
 *
 * @param eagerness - The eagerness level ('low' | 'medium' | 'high')
 * @returns AssemblyAI turn detection settings including threshold values and description
 */
export function getAssemblyAISettingsForEagerness(
  eagerness: 'low' | 'medium' | 'high' = 'low'
): AssemblyAITurnDetectionSettings {
  switch (eagerness) {
    case 'high': // Aggressive - per AssemblyAI docs
      // Use cases: Agent Assist, IVR replacements, Retail/E-commerce, Telecom
      return {
        endOfTurnConfidenceThreshold: 0.4,
        minEndOfTurnSilenceWhenConfident: 160,
        maxTurnSilence: 400,
        description:
          'Aggressive - Quick responses for rapid back-and-forth (IVR, order confirmations)',
      };
    case 'medium': // Balanced - per AssemblyAI docs
      // Use cases: Customer Support, Tech Support, Financial Services, Travel
      return {
        endOfTurnConfidenceThreshold: 0.4,
        minEndOfTurnSilenceWhenConfident: 400,
        maxTurnSilence: 1280,
        description:
          'Balanced - Natural middle ground for most conversational turns',
      };
    case 'low': // Conservative - per AssemblyAI docs
      // Use cases: Healthcare, Mental Health, Sales, Legal, LANGUAGE LEARNING
      return {
        endOfTurnConfidenceThreshold: 0.7,
        minEndOfTurnSilenceWhenConfident: 800,
        maxTurnSilence: 3600,
        description:
          'Conservative - Patient, allows thinking pauses (Language Learning, Healthcare)',
      };
  }
}
