/**
 * Language Configuration System
 *
 * This module provides a centralized configuration for all supported languages.
 * To add a new language:
 * 1. Add a new entry to SUPPORTED_LANGUAGES with all required fields
 * 2. The rest of the app will automatically support the new language
 */

export interface TeacherPersona {
  name: string;
  age: number;
  nationality: string;
  description: string;
}

export interface TTSConfig {
  speakerId: string;
  modelId: string;
  speakingRate: number;
  temperature: number;
  languageCode?: string; // Optional TTS language code (e.g., 'ja-JP')
}

export interface LanguageConfig {
  // Identifier
  code: string; // e.g., 'es', 'ja', 'fr'

  // Display names
  name: string; // English name: "Spanish"
  nativeName: string; // Native name: "Español"
  flag: string; // Emoji flag

  // STT configuration
  sttLanguageCode: string; // Language code for speech-to-text

  // TTS configuration
  ttsConfig: TTSConfig;

  // Teacher persona for this language
  teacherPersona: TeacherPersona;

  // Example conversation topics specific to this language's culture
  exampleTopics: string[];

  // Language-specific instructions for the LLM (written in English, about teaching this language)
  promptInstructions: string;
}

/**
 * Supported Languages Configuration
 *
 * Each language defines everything needed for:
 * - Speech recognition (STT)
 * - Text-to-speech (TTS)
 * - Teacher persona and conversation style
 * - Cultural context and example topics
 */
export const SUPPORTED_LANGUAGES: Record<string, LanguageConfig> = {
  es: {
    code: 'es',
    name: 'Spanish',
    nativeName: 'Español',
    flag: '🇲🇽',
    sttLanguageCode: 'es-MX', // Mexican Spanish
    ttsConfig: {
      speakerId: 'Diego',
      modelId: 'inworld-tts-1',
      speakingRate: 1,
      temperature: 0.7,
      languageCode: 'es-MX',
    },
    teacherPersona: {
      name: 'Señor Gael Herrera',
      age: 35,
      nationality: 'Mexican (Chilango)',
      description:
        "a 35 year old 'Chilango' (from Mexico City) who has loaned their brain to AI",
    },
    exampleTopics: [
      'Mexico City',
      'the Dunedin sound rock scene',
      'gardening',
      'the concept of brunch across cultures',
      'Balkan travel',
    ],
    promptInstructions: `
- Gently correct the user if they make mistakes in Spanish
- Use natural Mexican Spanish expressions when appropriate
- Vary complexity based on the user's level`,
  },

  ja: {
    code: 'ja',
    name: 'Japanese',
    nativeName: '日本語',
    flag: '🇯🇵',
    sttLanguageCode: 'ja-JP', // Japanese
    ttsConfig: {
      speakerId: 'Asuka',
      modelId: 'inworld-tts-1',
      speakingRate: 0.95,
      temperature: 0.7,
      languageCode: 'ja-JP',
    },
    teacherPersona: {
      name: '田中先生 (Tanaka-sensei)',
      age: 42,
      nationality: 'Japanese (Tokyo)',
      description:
        'a 42 year old Japanese teacher from Tokyo who loves sharing Japanese culture and language',
    },
    exampleTopics: [
      'Tokyo neighborhoods',
      'Japanese cuisine and izakaya culture',
      'anime and manga',
      'traditional arts like calligraphy and tea ceremony',
      'Japanese music from enka to J-pop',
      'seasonal festivals (matsuri)',
    ],
    promptInstructions: `
- Gently correct the user if they make mistakes in Japanese
- Explain the difference between casual and polite forms when relevant
- Introduce kanji gradually with furigana explanations when helpful
- Mention cultural context behind expressions (e.g., why certain phrases are used)
- Use romanji in parentheses when introducing new vocabulary`,
  },

  fr: {
    code: 'fr',
    name: 'French',
    nativeName: 'Français',
    flag: '🇫🇷',
    sttLanguageCode: 'fr-FR', // French
    ttsConfig: {
      speakerId: 'Alain',
      modelId: 'inworld-tts-1',
      speakingRate: 1,
      temperature: 0.7,
      languageCode: 'fr-FR',
    },
    teacherPersona: {
      name: 'Monsieur Lucien Dubois',
      age: 38,
      nationality: 'French (Parisian)',
      description:
        'a 38 year old Parisian who is passionate about French language, literature, and gastronomy',
    },
    exampleTopics: [
      'Parisian cafés and culture',
      'French cinema (nouvelle vague)',
      'wine regions and gastronomy',
      'French literature and philosophy',
      'travel in Provence and the French Riviera',
      'French music from Édith Piaf to modern artists',
    ],
    promptInstructions: `
- Gently correct the user if they make mistakes in French
- Pay attention to gender agreement and verb conjugation corrections
- Explain the nuances between formal (vous) and informal (tu) when relevant
- Share cultural context about French expressions and idioms
- Mention pronunciation tips for tricky French sounds`,
  },
};

/**
 * Get configuration for a specific language
 * @param code - Language code (e.g., 'es', 'ja', 'fr')
 * @returns Language configuration or default (Spanish) if not found
 */
export function getLanguageConfig(code: string): LanguageConfig {
  const config = SUPPORTED_LANGUAGES[code];
  if (!config) {
    console.warn(
      `Language '${code}' not found, falling back to Spanish (es)`
    );
    return SUPPORTED_LANGUAGES['es'];
  }
  return config;
}

/**
 * Get all supported language codes
 */
export function getSupportedLanguageCodes(): string[] {
  return Object.keys(SUPPORTED_LANGUAGES);
}

/**
 * Get language options for frontend dropdown
 */
export function getLanguageOptions(): Array<{
  code: string;
  name: string;
  nativeName: string;
  flag: string;
}> {
  return Object.values(SUPPORTED_LANGUAGES).map((lang) => ({
    code: lang.code,
    name: lang.name,
    nativeName: lang.nativeName,
    flag: lang.flag,
  }));
}

/**
 * Default language code
 */
export const DEFAULT_LANGUAGE_CODE = 'es';

