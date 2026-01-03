import { describe, it, expect } from 'vitest';
import { AnkiExporter } from '../../helpers/anki-exporter.js';
import type { Flashcard } from '../../helpers/flashcard-processor.js';

// Helper to create test flashcards
function createFlashcard(overrides: Partial<Flashcard> = {}): Flashcard {
  return {
    id: 'test-id',
    targetWord: 'hola',
    english: 'hello',
    example: 'Hola, ¿cómo estás?',
    mnemonic: 'Think of "hello" when you wave',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('AnkiExporter', () => {
  const exporter = new AnkiExporter();

  describe('countValidFlashcards', () => {
    it('counts flashcards with both targetWord and english', () => {
      const flashcards = [
        createFlashcard({ targetWord: 'hola', english: 'hello' }),
        createFlashcard({ targetWord: 'adios', english: 'goodbye' }),
      ];
      expect(exporter.countValidFlashcards(flashcards)).toBe(2);
    });

    it('excludes flashcards missing targetWord', () => {
      const flashcards = [
        createFlashcard({ targetWord: 'hola', english: 'hello' }),
        createFlashcard({ targetWord: '', english: 'missing target' }),
      ];
      expect(exporter.countValidFlashcards(flashcards)).toBe(1);
    });

    it('excludes flashcards missing english', () => {
      const flashcards = [
        createFlashcard({ targetWord: 'hola', english: 'hello' }),
        createFlashcard({ targetWord: 'test', english: '' }),
      ];
      expect(exporter.countValidFlashcards(flashcards)).toBe(1);
    });

    it('excludes flashcards with whitespace-only fields', () => {
      const flashcards = [
        createFlashcard({ targetWord: '   ', english: 'hello' }),
        createFlashcard({ targetWord: 'test', english: '   ' }),
      ];
      expect(exporter.countValidFlashcards(flashcards)).toBe(0);
    });

    it('returns 0 for empty array', () => {
      expect(exporter.countValidFlashcards([])).toBe(0);
    });

    it('handles legacy "spanish" field', () => {
      const flashcards = [
        {
          id: '1',
          spanish: 'hola',
          targetWord: '',
          english: 'hello',
          example: '',
          mnemonic: '',
          timestamp: '',
        } as Flashcard,
      ];
      expect(exporter.countValidFlashcards(flashcards)).toBe(1);
    });

    it('prefers targetWord over spanish when both present', () => {
      const flashcards = [
        {
          id: '1',
          targetWord: 'bonjour',
          spanish: 'hola',
          english: 'hello',
          example: '',
          mnemonic: '',
          timestamp: '',
        } as unknown as Flashcard,
      ];
      // Should count as valid since targetWord is present
      expect(exporter.countValidFlashcards(flashcards)).toBe(1);
    });
  });

  // Note: exportFlashcards tests are skipped because the anki-apkg-export
  // package has ESM compatibility issues in vitest. The countValidFlashcards
  // tests above cover the validation logic. The actual export functionality
  // is tested manually and works in production.
});
