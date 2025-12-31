import type { Flashcard, ConversationHistory } from '../types';

export class Storage {
  private storageKey = 'aprende-app-state';
  private conversationKey = 'aprende-conversation-history';
  private flashcardsKey = 'aprende-flashcards';
  private languageKey = 'aprende-language';
  private userIdKey = 'aprende-user-id';

  // User ID methods
  getOrCreateUserId(): string {
    try {
      let id = localStorage.getItem(this.userIdKey);
      if (!id) {
        id =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `u_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem(this.userIdKey, id);
      }
      return id;
    } catch {
      return `u_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }
  }

  // Language preference methods
  getLanguage(): string {
    try {
      return localStorage.getItem(this.languageKey) || 'es';
    } catch (error) {
      console.error('Failed to load language from localStorage:', error);
      return 'es';
    }
  }

  saveLanguage(languageCode: string): void {
    try {
      localStorage.setItem(this.languageKey, languageCode);
    } catch (error) {
      console.error('Failed to save language to localStorage:', error);
    }
  }

  // State methods
  saveState(state: { chatHistory: unknown[] }): void {
    try {
      const serializedState = JSON.stringify(state);
      localStorage.setItem(this.storageKey, serializedState);
    } catch (error) {
      console.error('Failed to save state to localStorage:', error);
    }
  }

  getState(): { chatHistory: unknown[] } | null {
    try {
      const serializedState = localStorage.getItem(this.storageKey);
      if (serializedState === null) {
        return null;
      }
      return JSON.parse(serializedState);
    } catch (error) {
      console.error('Failed to load state from localStorage:', error);
      return null;
    }
  }

  // Conversation history methods
  getConversationHistory(): ConversationHistory {
    try {
      const serializedHistory = localStorage.getItem(this.conversationKey);
      if (serializedHistory === null) {
        return { messages: [] };
      }
      return JSON.parse(serializedHistory);
    } catch (error) {
      console.error(
        'Failed to load conversation history from localStorage:',
        error
      );
      return { messages: [] };
    }
  }

  addMessage(role: 'user' | 'assistant', content: string): ConversationHistory {
    const history = this.getConversationHistory();

    const message = {
      role,
      content,
      timestamp: new Date().toISOString(),
    };

    history.messages.push(message);

    // Truncate to keep only last 40 turns (80 messages)
    if (history.messages.length > 80) {
      history.messages = history.messages.slice(-80);
    }

    try {
      const serializedHistory = JSON.stringify(history);
      localStorage.setItem(this.conversationKey, serializedHistory);
    } catch (error) {
      console.error(
        'Failed to save conversation history to localStorage:',
        error
      );
    }

    return history;
  }

  clearConversation(): void {
    try {
      localStorage.removeItem(this.conversationKey);
    } catch (error) {
      console.error(
        'Failed to clear conversation history from localStorage:',
        error
      );
    }
  }

  // Flashcard methods
  private getFlashcardsKey(languageCode?: string): string {
    if (!languageCode) {
      return this.flashcardsKey;
    }
    return `${this.flashcardsKey}-${languageCode}`;
  }

  getFlashcards(languageCode: string): Flashcard[] {
    try {
      const key = this.getFlashcardsKey(languageCode);
      const serializedFlashcards = localStorage.getItem(key);
      if (serializedFlashcards === null) {
        // Try to migrate from old format if no language-specific data exists
        if (languageCode === 'es') {
          const oldFlashcards = localStorage.getItem(this.flashcardsKey);
          if (oldFlashcards) {
            const parsed = JSON.parse(oldFlashcards) as Flashcard[];
            const migrated = parsed.map((card) => ({
              ...card,
              targetWord: card.targetWord || card.spanish || '',
              languageCode: 'es',
            }));
            this.saveFlashcards(migrated, 'es');
            return migrated;
          }
        }
        return [];
      }
      return JSON.parse(serializedFlashcards);
    } catch (error) {
      console.error('Failed to load flashcards from localStorage:', error);
      return [];
    }
  }

  saveFlashcards(flashcards: Flashcard[], languageCode: string): void {
    try {
      const key = this.getFlashcardsKey(languageCode);
      const serializedFlashcards = JSON.stringify(flashcards);
      localStorage.setItem(key, serializedFlashcards);
    } catch (error) {
      console.error('Failed to save flashcards to localStorage:', error);
    }
  }

  addFlashcards(newFlashcards: Flashcard[], languageCode: string): Flashcard[] {
    const existingFlashcards = this.getFlashcards(languageCode);

    // Filter out duplicates
    const uniqueNewFlashcards = newFlashcards.filter((newCard) => {
      const newWord = newCard.targetWord || newCard.spanish || '';
      return !existingFlashcards.some((existing) => {
        const existingWord = existing.targetWord || existing.spanish || '';
        return existingWord.toLowerCase() === newWord.toLowerCase();
      });
    });

    // Add language code to new flashcards
    const flashcardsWithLanguage = uniqueNewFlashcards.map((card) => ({
      ...card,
      targetWord: card.targetWord || card.spanish || '',
      languageCode,
    }));

    const updatedFlashcards = [
      ...existingFlashcards,
      ...flashcardsWithLanguage,
    ];

    // Keep only the last 100 flashcards per language
    if (updatedFlashcards.length > 100) {
      updatedFlashcards.splice(0, updatedFlashcards.length - 100);
    }

    this.saveFlashcards(updatedFlashcards, languageCode);
    return updatedFlashcards;
  }

  clearFlashcards(languageCode: string): void {
    try {
      const key = this.getFlashcardsKey(languageCode);
      localStorage.removeItem(key);
    } catch (error) {
      console.error('Failed to clear flashcards from localStorage:', error);
    }
  }
}
