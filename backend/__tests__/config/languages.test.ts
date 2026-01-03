import { describe, it, expect } from 'vitest';
import {
  getLanguageConfig,
  getSupportedLanguageCodes,
  getLanguageOptions,
  DEFAULT_LANGUAGE_CODE,
  SUPPORTED_LANGUAGES,
} from '../../config/languages.js';

describe('languages config', () => {
  describe('getLanguageConfig', () => {
    it('returns Spanish config for "es"', () => {
      const config = getLanguageConfig('es');
      expect(config.code).toBe('es');
      expect(config.name).toBe('Spanish');
      expect(config.teacherPersona.name).toBe('Señor Gael Herrera');
    });

    it('returns English config for "en"', () => {
      const config = getLanguageConfig('en');
      expect(config.code).toBe('en');
      expect(config.name).toBe('English');
      expect(config.ttsConfig.speakerId).toBe('Ashley');
    });

    it('returns French config for "fr"', () => {
      const config = getLanguageConfig('fr');
      expect(config.code).toBe('fr');
      expect(config.name).toBe('French');
      expect(config.ttsConfig.speakerId).toBe('Alain');
    });

    it('returns fallback to Spanish for unknown language code', () => {
      const config = getLanguageConfig('zz');
      expect(config.code).toBe('es');
    });

    it('returns fallback to Spanish for empty string', () => {
      const config = getLanguageConfig('');
      expect(config.code).toBe('es');
    });

    it('has required fields for each supported language', () => {
      const codes = getSupportedLanguageCodes();
      for (const code of codes) {
        const config = getLanguageConfig(code);
        expect(config.code).toBe(code);
        expect(config.name).toBeTruthy();
        expect(config.nativeName).toBeTruthy();
        expect(config.flag).toBeTruthy();
        expect(config.sttLanguageCode).toBeTruthy();
        expect(config.ttsConfig).toBeDefined();
        expect(config.ttsConfig.speakerId).toBeTruthy();
        expect(config.ttsConfig.modelId).toBeTruthy();
        expect(config.teacherPersona).toBeDefined();
        expect(config.teacherPersona.name).toBeTruthy();
        expect(config.exampleTopics.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getSupportedLanguageCodes', () => {
    it('returns array of supported language codes', () => {
      const codes = getSupportedLanguageCodes();
      expect(Array.isArray(codes)).toBe(true);
      expect(codes.length).toBeGreaterThan(0);
    });

    it('includes expected languages', () => {
      const codes = getSupportedLanguageCodes();
      expect(codes).toContain('es');
      expect(codes).toContain('en');
      expect(codes).toContain('fr');
      expect(codes).toContain('de');
    });

    it('matches SUPPORTED_LANGUAGES keys', () => {
      const codes = getSupportedLanguageCodes();
      expect(codes.length).toBe(Object.keys(SUPPORTED_LANGUAGES).length);
      for (const code of codes) {
        expect(SUPPORTED_LANGUAGES[code]).toBeDefined();
      }
    });
  });

  describe('getLanguageOptions', () => {
    it('returns options with code, name, nativeName, and flag', () => {
      const options = getLanguageOptions();
      expect(Array.isArray(options)).toBe(true);
      expect(options.length).toBeGreaterThan(0);

      for (const option of options) {
        expect(option.code).toBeTruthy();
        expect(option.name).toBeTruthy();
        expect(option.nativeName).toBeTruthy();
        expect(option.flag).toBeTruthy();
      }
    });

    it('returns Spanish with correct properties', () => {
      const options = getLanguageOptions();
      const spanish = options.find((o) => o.code === 'es');

      expect(spanish).toBeDefined();
      expect(spanish!.name).toBe('Spanish');
      expect(spanish!.nativeName).toBe('Español');
    });

    it('has same count as supported languages', () => {
      const options = getLanguageOptions();
      const codes = getSupportedLanguageCodes();
      expect(options.length).toBe(codes.length);
    });
  });

  describe('DEFAULT_LANGUAGE_CODE', () => {
    it('is a valid supported language', () => {
      const codes = getSupportedLanguageCodes();
      expect(codes).toContain(DEFAULT_LANGUAGE_CODE);
    });

    it('is Spanish', () => {
      expect(DEFAULT_LANGUAGE_CODE).toBe('es');
    });
  });

  describe('TTS configurations', () => {
    it('each language has valid TTS config', () => {
      const codes = getSupportedLanguageCodes();
      for (const code of codes) {
        const config = getLanguageConfig(code);
        expect(config.ttsConfig.speakingRate).toBeGreaterThan(0);
        expect(config.ttsConfig.temperature).toBeGreaterThan(0);
      }
    });
  });

  describe('teacher personas', () => {
    it('each language has a teacher with valid age', () => {
      const codes = getSupportedLanguageCodes();
      for (const code of codes) {
        const config = getLanguageConfig(code);
        expect(config.teacherPersona.age).toBeGreaterThan(20);
        expect(config.teacherPersona.age).toBeLessThan(100);
      }
    });

    it('each language has a teacher with nationality', () => {
      const codes = getSupportedLanguageCodes();
      for (const code of codes) {
        const config = getLanguageConfig(code);
        expect(config.teacherPersona.nationality).toBeTruthy();
      }
    });
  });
});
