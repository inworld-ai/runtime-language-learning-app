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
  en: {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    flag: '🇺🇸',
    sttLanguageCode: 'en-US',
    ttsConfig: {
      speakerId: 'Ashley',
      modelId: 'inworld-tts-1.5',
      speakingRate: 1,
      temperature: 1.1,
      languageCode: 'en-US',
    },
    teacherPersona: {
      name: 'Ms. Sarah Mitchell',
      age: 34,
      nationality: 'American (New York)',
      description:
        'a 34 year old New Yorker who loves teaching English through everyday conversations and pop culture',
    },
    exampleTopics: [
      'New York City life',
      'American movies and TV shows',
      'sports and outdoor activities',
      'American idioms and slang',
      'travel across the United States',
    ],
    promptInstructions: `
- Gently correct the user if they make mistakes in English
- Explain common idioms and phrasal verbs when they come up naturally
- Help with pronunciation of tricky English sounds
- Vary complexity based on the user's level`,
  },

  es: {
    code: 'es',
    name: 'Spanish',
    nativeName: 'Español',
    flag: '🇲🇽',
    sttLanguageCode: 'es-MX', // Mexican Spanish
    ttsConfig: {
      speakerId: 'Diego',
      modelId: 'inworld-tts-1',
      speakingRate: 1.1,
      temperature: 1.1,
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

  fr: {
    code: 'fr',
    name: 'French',
    nativeName: 'Français',
    flag: '🇫🇷',
    sttLanguageCode: 'fr-FR',
    ttsConfig: {
      speakerId: 'Alain',
      modelId: 'inworld-tts-1',
      speakingRate: 1,
      temperature: 1.1,
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

  de: {
    code: 'de',
    name: 'German',
    nativeName: 'Deutsch',
    flag: '🇩🇪',
    sttLanguageCode: 'de-DE',
    ttsConfig: {
      speakerId: 'Josef',
      modelId: 'inworld-tts-1',
      speakingRate: 1,
      temperature: 0.7,
      languageCode: 'de-DE',
    },
    teacherPersona: {
      name: 'Herr Klaus Weber',
      age: 45,
      nationality: 'German (Berlin)',
      description:
        'a 45 year old Berliner who enjoys teaching German through history, philosophy, and modern culture',
    },
    exampleTopics: [
      'Berlin history and reunification',
      'German beer and food culture',
      'classical music and composers',
      'German engineering and innovation',
      'traveling through Bavaria and the Alps',
      'German literature from Goethe to modern authors',
    ],
    promptInstructions: `
- Gently correct the user if they make mistakes in German
- Help with noun genders (der, die, das) and case endings
- Explain compound word formation when relevant
- Share cultural context about German expressions
- Help with word order in main and subordinate clauses`,
  },

  it: {
    code: 'it',
    name: 'Italian',
    nativeName: 'Italiano',
    flag: '🇮🇹',
    sttLanguageCode: 'it-IT',
    ttsConfig: {
      speakerId: 'Orietta',
      modelId: 'inworld-tts-1',
      speakingRate: 1,
      temperature: 1.1,
      languageCode: 'it-IT',
    },
    teacherPersona: {
      name: 'Signora Maria Rossi',
      age: 40,
      nationality: 'Italian (Roman)',
      description:
        'a 40 year old Roman who is passionate about Italian art, cuisine, and la dolce vita',
    },
    exampleTopics: [
      'Roman history and ancient sites',
      'Italian cuisine and regional specialties',
      'Renaissance art and architecture',
      'Italian cinema and neorealism',
      'fashion and design in Milan',
      'Italian music from opera to modern pop',
    ],
    promptInstructions: `
- Gently correct the user if they make mistakes in Italian
- Help with verb conjugations and tenses
- Explain the use of formal (Lei) vs informal (tu) when relevant
- Share cultural context about Italian expressions and gestures
- Mention regional variations when appropriate`,
  },

  pt: {
    code: 'pt',
    name: 'Portuguese',
    nativeName: 'Português',
    flag: '🇧🇷',
    sttLanguageCode: 'pt-BR', // Brazilian Portuguese
    ttsConfig: {
      speakerId: 'Heitor',
      modelId: 'inworld-tts-1',
      speakingRate: 1,
      temperature: 0.7,
      languageCode: 'pt-BR',
    },
    teacherPersona: {
      name: 'Senhor João Silva',
      age: 36,
      nationality: 'Brazilian (Carioca)',
      description:
        'a 36 year old Carioca from Rio de Janeiro who loves sharing Brazilian culture, music, and the joy of Portuguese',
    },
    exampleTopics: [
      'Rio de Janeiro and Brazilian beaches',
      'Brazilian music from bossa nova to funk',
      'Carnival and Brazilian festivals',
      'Brazilian cuisine and churrasco',
      'football (soccer) culture',
      'the Amazon and Brazilian nature',
    ],
    promptInstructions: `
- Gently correct the user if they make mistakes in Portuguese
- Use natural Brazilian Portuguese expressions when appropriate
- Explain differences between Brazilian and European Portuguese when relevant
- Help with verb conjugations and the subjunctive mood
- Share cultural context about Brazilian expressions and slang`,
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
      `Language '${code}' not found, falling back to Spanish (es).`
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

