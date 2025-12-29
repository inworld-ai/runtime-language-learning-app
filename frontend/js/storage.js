export class Storage {
  constructor() {
    this.storageKey = 'aprende-app-state';
    this.conversationKey = 'aprende-conversation-history';
    this.flashcardsKey = 'aprende-flashcards';
    this.languageKey = 'aprende-language';
  }

  // Language preference methods
  getLanguage() {
    try {
      return localStorage.getItem(this.languageKey) || 'es';
    } catch (error) {
      console.error('Failed to load language from localStorage:', error);
      return 'es';
    }
  }

  saveLanguage(languageCode) {
    try {
      localStorage.setItem(this.languageKey, languageCode);
    } catch (error) {
      console.error('Failed to save language to localStorage:', error);
    }
  }

  saveState(state) {
    try {
      const serializedState = JSON.stringify(state);
      localStorage.setItem(this.storageKey, serializedState);
    } catch (error) {
      console.error('Failed to save state to localStorage:', error);
    }
  }

  getState() {
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

  clearState() {
    try {
      localStorage.removeItem(this.storageKey);
    } catch (error) {
      console.error('Failed to clear state from localStorage:', error);
    }
  }

  // Conversation history methods
  getConversationHistory() {
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

  addMessage(role, content) {
    const history = this.getConversationHistory();

    // Add new message with timestamp
    const message = {
      role: role,
      content: content,
      timestamp: new Date().toISOString(),
    };

    history.messages.push(message);

    // Truncate to keep only last 40 turns (80 messages: 40 user + 40 assistant)
    if (history.messages.length > 80) {
      history.messages = history.messages.slice(-80);
    }

    // Save updated history
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

  clearConversation() {
    try {
      localStorage.removeItem(this.conversationKey);
    } catch (error) {
      console.error(
        'Failed to clear conversation history from localStorage:',
        error
      );
    }
  }

  // Flashcard methods - now support per-language storage
  _getFlashcardsKey(languageCode) {
    if (!languageCode) {
      return this.flashcardsKey;
    }
    return `${this.flashcardsKey}-${languageCode}`;
  }

  getFlashcards(languageCode) {
    try {
      const key = this._getFlashcardsKey(languageCode);
      const serializedFlashcards = localStorage.getItem(key);
      if (serializedFlashcards === null) {
        // Try to migrate from old format if no language-specific data exists
        if (languageCode === 'es') {
          const oldFlashcards = localStorage.getItem(this.flashcardsKey);
          if (oldFlashcards) {
            const parsed = JSON.parse(oldFlashcards);
            // Migrate old flashcards to new format
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

  saveFlashcards(flashcards, languageCode) {
    try {
      const key = this._getFlashcardsKey(languageCode);
      const serializedFlashcards = JSON.stringify(flashcards);
      localStorage.setItem(key, serializedFlashcards);
    } catch (error) {
      console.error('Failed to save flashcards to localStorage:', error);
    }
  }

  addFlashcards(newFlashcards, languageCode) {
    const existingFlashcards = this.getFlashcards(languageCode);

    // Filter out duplicates based on targetWord (backwards compatible with spanish)
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
      languageCode: languageCode,
    }));

    const updatedFlashcards = [...existingFlashcards, ...flashcardsWithLanguage];

    // Keep only the last 100 flashcards per language
    if (updatedFlashcards.length > 100) {
      updatedFlashcards.splice(0, updatedFlashcards.length - 100);
    }

    this.saveFlashcards(updatedFlashcards, languageCode);
    return updatedFlashcards;
  }

  clearFlashcards(languageCode) {
    try {
      const key = this._getFlashcardsKey(languageCode);
      localStorage.removeItem(key);
    } catch (error) {
      console.error('Failed to clear flashcards from localStorage:', error);
    }
  }

  // Clear all flashcards for all languages
  clearAllFlashcards() {
    try {
      // Clear the base key
      localStorage.removeItem(this.flashcardsKey);
      // Clear language-specific keys
      const languages = ['es', 'ja', 'fr'];
      languages.forEach((lang) => {
        localStorage.removeItem(this._getFlashcardsKey(lang));
      });
    } catch (error) {
      console.error('Failed to clear all flashcards from localStorage:', error);
    }
  }
}
