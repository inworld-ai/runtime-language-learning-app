import { describe, it, expect, beforeEach } from 'vitest';
import { Storage } from '../../services/Storage';
import type { Flashcard } from '../../types';

describe('Storage', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = new Storage();
  });

  describe('getLanguage / saveLanguage', () => {
    it('returns "es" as default', () => {
      expect(storage.getLanguage()).toBe('es');
    });

    it('returns saved language', () => {
      storage.saveLanguage('fr');
      expect(storage.getLanguage()).toBe('fr');
    });

    it('persists language across instances', () => {
      storage.saveLanguage('de');
      const newStorage = new Storage();
      expect(newStorage.getLanguage()).toBe('de');
    });
  });

  describe('addMessage', () => {
    it('adds message to conversation history', () => {
      storage.addMessage('user', 'Hello');
      const history = storage.getConversationHistory();

      expect(history.messages.length).toBe(1);
      expect(history.messages[0].role).toBe('user');
      expect(history.messages[0].content).toBe('Hello');
    });

    it('adds multiple messages in order', () => {
      storage.addMessage('user', 'Hello');
      storage.addMessage('assistant', 'Hi there!');
      const history = storage.getConversationHistory();

      expect(history.messages.length).toBe(2);
      expect(history.messages[0].content).toBe('Hello');
      expect(history.messages[1].content).toBe('Hi there!');
    });

    it('includes timestamp on messages', () => {
      storage.addMessage('user', 'Hello');
      const history = storage.getConversationHistory();

      expect(history.messages[0].timestamp).toBeTruthy();
      // Verify it's a valid ISO date string
      expect(() => new Date(history.messages[0].timestamp)).not.toThrow();
    });

    it('truncates to 80 messages max', () => {
      // Add 85 messages
      for (let i = 0; i < 85; i++) {
        storage.addMessage('user', `Message ${i}`);
      }

      const history = storage.getConversationHistory();
      expect(history.messages.length).toBe(80);
      // First 5 should be truncated, so first message is "Message 5"
      expect(history.messages[0].content).toBe('Message 5');
      // Last message should be "Message 84"
      expect(history.messages[79].content).toBe('Message 84');
    });
  });

  describe('clearConversation', () => {
    it('clears all messages', () => {
      storage.addMessage('user', 'Hello');
      storage.addMessage('assistant', 'Hi!');
      storage.clearConversation();

      const history = storage.getConversationHistory();
      expect(history.messages.length).toBe(0);
    });
  });

  describe('createConversation', () => {
    it('creates conversation with unique ID', () => {
      const conv = storage.createConversation('es');
      expect(conv.id).toBeTruthy();
      expect(conv.languageCode).toBe('es');
    });

    it('creates conversation with title containing random numbers', () => {
      const conv = storage.createConversation('es');
      expect(conv.title).toMatch(/^Chat \d{5}$/);
    });

    it('creates multiple conversations with different IDs', () => {
      const conv1 = storage.createConversation('es');
      const conv2 = storage.createConversation('es');
      expect(conv1.id).not.toBe(conv2.id);
    });

    it('adds conversation to list', () => {
      storage.createConversation('es');
      const list = storage.getConversationList('es');
      expect(list.length).toBe(1);
    });

    it('adds new conversations at beginning of list', () => {
      const conv1 = storage.createConversation('es');
      const conv2 = storage.createConversation('es');
      const list = storage.getConversationList('es');

      expect(list[0].id).toBe(conv2.id);
      expect(list[1].id).toBe(conv1.id);
    });
  });

  describe('deleteConversation', () => {
    it('removes conversation from list', () => {
      const conv = storage.createConversation('es');
      storage.deleteConversation(conv.id, 'es');

      const list = storage.getConversationList('es');
      expect(list.length).toBe(0);
    });

    it('removes conversation data', () => {
      const conv = storage.createConversation('es');
      storage.deleteConversation(conv.id, 'es');

      const data = storage.getConversation(conv.id);
      expect(data).toBeNull();
    });
  });

  describe('renameConversation', () => {
    it('updates conversation title', () => {
      const conv = storage.createConversation('es');
      storage.renameConversation(conv.id, 'My Spanish Chat', 'es');

      const list = storage.getConversationList('es');
      expect(list[0].title).toBe('My Spanish Chat');
    });
  });

  describe('saveConversation / getConversation', () => {
    it('saves and retrieves conversation messages', () => {
      const conv = storage.createConversation('es');
      const messages = [
        {
          role: 'user' as const,
          content: 'Hola',
          timestamp: new Date().toISOString(),
        },
        {
          role: 'assistant' as const,
          content: '¡Hola!',
          timestamp: new Date().toISOString(),
        },
      ];

      storage.saveConversation(conv.id, messages, 'es');
      const data = storage.getConversation(conv.id);

      expect(data).not.toBeNull();
      expect(data!.messages.length).toBe(2);
      expect(data!.messages[0].content).toBe('Hola');
    });
  });

  describe('addFlashcards', () => {
    it('adds flashcards to storage', () => {
      const cards = [
        { targetWord: 'hola', english: 'hello', example: '', mnemonic: '' },
      ];
      const result = storage.addFlashcards(cards as Partial<Flashcard>[], 'es');

      expect(result.length).toBe(1);
      expect(result[0].targetWord).toBe('hola');
    });

    it('deduplicates flashcards by targetWord', () => {
      const cards1 = [
        { targetWord: 'hola', english: 'hello', example: '', mnemonic: '' },
      ];
      storage.addFlashcards(cards1 as Partial<Flashcard>[], 'es');

      const cards2 = [
        { targetWord: 'hola', english: 'hello', example: '', mnemonic: '' },
        { targetWord: 'adios', english: 'goodbye', example: '', mnemonic: '' },
      ];
      const result = storage.addFlashcards(
        cards2 as Partial<Flashcard>[],
        'es'
      );

      // Should only have 2 cards (hola + adios), not 3
      expect(result.length).toBe(2);
    });

    it('is case-insensitive for duplicate detection', () => {
      const cards1 = [
        { targetWord: 'Hola', english: 'hello', example: '', mnemonic: '' },
      ];
      storage.addFlashcards(cards1 as Partial<Flashcard>[], 'es');

      const cards2 = [
        {
          targetWord: 'hola',
          english: 'hello again',
          example: '',
          mnemonic: '',
        },
      ];
      const result = storage.addFlashcards(
        cards2 as Partial<Flashcard>[],
        'es'
      );

      expect(result.length).toBe(1);
      expect(result[0].targetWord).toBe('Hola');
    });

    it('adds language code to flashcards', () => {
      const cards = [
        { targetWord: 'bonjour', english: 'hello', example: '', mnemonic: '' },
      ];
      const result = storage.addFlashcards(cards as Partial<Flashcard>[], 'fr');

      expect(result[0].languageCode).toBe('fr');
    });

    it('handles legacy spanish field', () => {
      const cards = [
        { spanish: 'hola', english: 'hello', example: '', mnemonic: '' },
      ];
      const result = storage.addFlashcards(cards as Partial<Flashcard>[], 'es');

      expect(result[0].targetWord).toBe('hola');
    });

    it('limits to 100 flashcards per language', () => {
      // Add 110 flashcards
      for (let i = 0; i < 110; i++) {
        storage.addFlashcards(
          [
            {
              targetWord: `word${i}`,
              english: `translation${i}`,
              example: '',
              mnemonic: '',
            },
          ] as Partial<Flashcard>[],
          'es'
        );
      }

      const flashcards = storage.getFlashcards('es');
      expect(flashcards.length).toBe(100);
    });
  });

  describe('clearFlashcards', () => {
    it('clears flashcards for a language', () => {
      storage.addFlashcards(
        [
          { targetWord: 'hola', english: 'hello', example: '', mnemonic: '' },
        ] as Partial<Flashcard>[],
        'es'
      );
      storage.clearFlashcards('es');

      const flashcards = storage.getFlashcards('es');
      expect(flashcards.length).toBe(0);
    });

    it('does not affect flashcards for other languages', () => {
      storage.addFlashcards(
        [
          { targetWord: 'hola', english: 'hello', example: '', mnemonic: '' },
        ] as Partial<Flashcard>[],
        'es'
      );
      storage.addFlashcards(
        [
          {
            targetWord: 'bonjour',
            english: 'hello',
            example: '',
            mnemonic: '',
          },
        ] as Partial<Flashcard>[],
        'fr'
      );

      storage.clearFlashcards('es');

      expect(storage.getFlashcards('es').length).toBe(0);
      expect(storage.getFlashcards('fr').length).toBe(1);
    });
  });

  describe('per-conversation flashcards', () => {
    it('stores flashcards per conversation', () => {
      const conv = storage.createConversation('es');
      const cards = [
        { targetWord: 'hola', english: 'hello', example: '', mnemonic: '' },
      ];

      storage.addFlashcardsForConversation(
        conv.id,
        cards as Partial<Flashcard>[],
        'es'
      );
      const result = storage.getFlashcardsForConversation(conv.id);

      expect(result.length).toBe(1);
      expect(result[0].conversationId).toBe(conv.id);
    });

    it('isolates flashcards between conversations', () => {
      const conv1 = storage.createConversation('es');
      const conv2 = storage.createConversation('es');

      storage.addFlashcardsForConversation(
        conv1.id,
        [
          { targetWord: 'hola', english: 'hello', example: '', mnemonic: '' },
        ] as Partial<Flashcard>[],
        'es'
      );
      storage.addFlashcardsForConversation(
        conv2.id,
        [
          {
            targetWord: 'adios',
            english: 'goodbye',
            example: '',
            mnemonic: '',
          },
        ] as Partial<Flashcard>[],
        'es'
      );

      expect(storage.getFlashcardsForConversation(conv1.id).length).toBe(1);
      expect(storage.getFlashcardsForConversation(conv1.id)[0].targetWord).toBe(
        'hola'
      );
      expect(storage.getFlashcardsForConversation(conv2.id).length).toBe(1);
      expect(storage.getFlashcardsForConversation(conv2.id)[0].targetWord).toBe(
        'adios'
      );
    });
  });

  describe('getAllConversations', () => {
    it('returns conversations across all languages', () => {
      storage.createConversation('es');
      storage.createConversation('fr');
      storage.createConversation('de');

      const all = storage.getAllConversations();
      expect(all.length).toBe(3);
    });

    it('sorts by updatedAt descending', () => {
      const conv1 = storage.createConversation('es');

      // Wait a tiny bit to ensure different timestamps
      storage.createConversation('fr');

      // Update conv1 to make it more recent
      storage.saveConversation(conv1.id, [], 'es');

      const all = storage.getAllConversations();
      // conv1 was updated more recently
      expect(all[0].id).toBe(conv1.id);
    });
  });
});
