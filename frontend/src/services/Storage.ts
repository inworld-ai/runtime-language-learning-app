import type {
  Flashcard,
  ConversationHistory,
  ConversationSummary,
  ConversationData,
  ConversationMessage,
} from '../types';

export class Storage {
  private storageKey = 'aprende-app-state';
  private conversationKey = 'aprende-conversation-history'; // Legacy single conversation
  private conversationsListKeyPrefix = 'aprende-conversations-'; // + languageCode
  private conversationDataKeyPrefix = 'aprende-conversation-'; // + conversationId
  private currentConversationKeyPrefix = 'aprende-current-conversation-'; // + languageCode
  private flashcardsKey = 'aprende-flashcards'; // Legacy per-language flashcards
  private flashcardsConversationKeyPrefix = 'aprende-flashcards-conv-'; // + conversationId
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

  // Multi-conversation methods

  private generateId(): string {
    return typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `c_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  getConversationList(languageCode: string): ConversationSummary[] {
    try {
      const key = this.conversationsListKeyPrefix + languageCode;
      const data = localStorage.getItem(key);
      if (!data) {
        // Check for legacy data to migrate
        return this.migrateToMultiConversation(languageCode);
      }
      return JSON.parse(data);
    } catch (error) {
      console.error('Failed to load conversation list:', error);
      return [];
    }
  }

  private migrateToMultiConversation(
    languageCode: string
  ): ConversationSummary[] {
    // Check if there's legacy conversation data
    const legacyData = localStorage.getItem(this.conversationKey);
    const currentLanguage = this.getLanguage();

    // Only migrate if we have legacy data AND we're loading for the same language
    if (legacyData && currentLanguage === languageCode) {
      try {
        const legacy = JSON.parse(legacyData) as ConversationHistory;
        if (legacy.messages && legacy.messages.length > 0) {
          // Create first conversation from legacy data
          const conversationId = this.generateId();
          const now = new Date().toISOString();
          const randomNumbers = Math.floor(10000 + Math.random() * 90000);
          const summary: ConversationSummary = {
            id: conversationId,
            title: `Chat ${randomNumbers}`,
            languageCode,
            createdAt: now,
            updatedAt: now,
          };

          const conversationData: ConversationData = {
            id: conversationId,
            messages: legacy.messages,
          };

          // Save the migrated data
          localStorage.setItem(
            this.conversationsListKeyPrefix + languageCode,
            JSON.stringify([summary])
          );
          localStorage.setItem(
            this.conversationDataKeyPrefix + conversationId,
            JSON.stringify(conversationData)
          );
          localStorage.setItem(
            this.currentConversationKeyPrefix + languageCode,
            conversationId
          );

          // Remove legacy data
          localStorage.removeItem(this.conversationKey);

          return [summary];
        }
      } catch (error) {
        console.error('Failed to migrate legacy conversation:', error);
      }
    }
    return [];
  }

  getConversation(conversationId: string): ConversationData | null {
    try {
      const key = this.conversationDataKeyPrefix + conversationId;
      const data = localStorage.getItem(key);
      if (!data) return null;
      return JSON.parse(data);
    } catch (error) {
      console.error('Failed to load conversation:', error);
      return null;
    }
  }

  saveConversation(
    conversationId: string,
    messages: ConversationMessage[],
    languageCode: string
  ): void {
    try {
      const conversationData: ConversationData = {
        id: conversationId,
        messages,
      };
      localStorage.setItem(
        this.conversationDataKeyPrefix + conversationId,
        JSON.stringify(conversationData)
      );

      // Update the summary's updatedAt timestamp
      const list = this.getConversationList(languageCode);
      const index = list.findIndex((c) => c.id === conversationId);
      if (index !== -1) {
        list[index].updatedAt = new Date().toISOString();
        localStorage.setItem(
          this.conversationsListKeyPrefix + languageCode,
          JSON.stringify(list)
        );
      }
    } catch (error) {
      console.error('Failed to save conversation:', error);
    }
  }

  createConversation(languageCode: string): ConversationSummary {
    const list = this.getConversationList(languageCode);
    const now = new Date().toISOString();
    const conversationId = this.generateId();
    const randomNumbers = Math.floor(10000 + Math.random() * 90000);

    const summary: ConversationSummary = {
      id: conversationId,
      title: `Chat ${randomNumbers}`,
      languageCode,
      createdAt: now,
      updatedAt: now,
    };

    // Add to beginning of list (most recent first)
    list.unshift(summary);

    localStorage.setItem(
      this.conversationsListKeyPrefix + languageCode,
      JSON.stringify(list)
    );

    // Create empty conversation data
    const conversationData: ConversationData = {
      id: conversationId,
      messages: [],
    };
    localStorage.setItem(
      this.conversationDataKeyPrefix + conversationId,
      JSON.stringify(conversationData)
    );

    return summary;
  }

  deleteConversation(conversationId: string, languageCode: string): void {
    try {
      // Remove conversation data
      localStorage.removeItem(this.conversationDataKeyPrefix + conversationId);

      // Remove from list
      const list = this.getConversationList(languageCode);
      const filtered = list.filter((c) => c.id !== conversationId);
      localStorage.setItem(
        this.conversationsListKeyPrefix + languageCode,
        JSON.stringify(filtered)
      );

      // If this was the current conversation, clear current
      const currentId = this.getCurrentConversationId(languageCode);
      if (currentId === conversationId) {
        localStorage.removeItem(
          this.currentConversationKeyPrefix + languageCode
        );
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  }

  renameConversation(
    conversationId: string,
    newTitle: string,
    languageCode: string
  ): void {
    try {
      const list = this.getConversationList(languageCode);
      const index = list.findIndex((c) => c.id === conversationId);
      if (index !== -1) {
        list[index].title = newTitle;
        list[index].updatedAt = new Date().toISOString();
        localStorage.setItem(
          this.conversationsListKeyPrefix + languageCode,
          JSON.stringify(list)
        );
      }
    } catch (error) {
      console.error('Failed to rename conversation:', error);
    }
  }

  getCurrentConversationId(languageCode: string): string | null {
    try {
      return localStorage.getItem(
        this.currentConversationKeyPrefix + languageCode
      );
    } catch {
      return null;
    }
  }

  setCurrentConversationId(languageCode: string, conversationId: string): void {
    try {
      localStorage.setItem(
        this.currentConversationKeyPrefix + languageCode,
        conversationId
      );
    } catch (error) {
      console.error('Failed to set current conversation:', error);
    }
  }

  getAllConversations(): ConversationSummary[] {
    try {
      const allConversations: ConversationSummary[] = [];
      // Iterate through all localStorage keys to find conversation lists
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(this.conversationsListKeyPrefix)) {
          const data = localStorage.getItem(key);
          if (data) {
            const conversations = JSON.parse(data) as ConversationSummary[];
            allConversations.push(...conversations);
          }
        }
      }
      // Sort by updatedAt descending (most recent first)
      allConversations.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      return allConversations;
    } catch (error) {
      console.error('Failed to get all conversations:', error);
      return [];
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

  // Per-conversation flashcard methods
  getFlashcardsForConversation(conversationId: string): Flashcard[] {
    try {
      const key = this.flashcardsConversationKeyPrefix + conversationId;
      const data = localStorage.getItem(key);
      if (!data) return [];
      return JSON.parse(data);
    } catch (error) {
      console.error('Failed to load flashcards for conversation:', error);
      return [];
    }
  }

  saveFlashcardsForConversation(
    conversationId: string,
    flashcards: Flashcard[]
  ): void {
    try {
      const key = this.flashcardsConversationKeyPrefix + conversationId;
      localStorage.setItem(key, JSON.stringify(flashcards));
    } catch (error) {
      console.error('Failed to save flashcards for conversation:', error);
    }
  }

  addFlashcardsForConversation(
    conversationId: string,
    newFlashcards: Flashcard[],
    languageCode: string
  ): Flashcard[] {
    const existingFlashcards =
      this.getFlashcardsForConversation(conversationId);

    // Filter out duplicates
    const uniqueNewFlashcards = newFlashcards.filter((newCard) => {
      const newWord = newCard.targetWord || newCard.spanish || '';
      return !existingFlashcards.some((existing) => {
        const existingWord = existing.targetWord || existing.spanish || '';
        return existingWord.toLowerCase() === newWord.toLowerCase();
      });
    });

    // Add conversation ID and language code to new flashcards
    const flashcardsWithIds = uniqueNewFlashcards.map((card) => ({
      ...card,
      targetWord: card.targetWord || card.spanish || '',
      conversationId,
      languageCode,
    }));

    const updatedFlashcards = [...existingFlashcards, ...flashcardsWithIds];

    // Keep only the last 100 flashcards per conversation
    if (updatedFlashcards.length > 100) {
      updatedFlashcards.splice(0, updatedFlashcards.length - 100);
    }

    this.saveFlashcardsForConversation(conversationId, updatedFlashcards);
    return updatedFlashcards;
  }

  clearFlashcardsForConversation(conversationId: string): void {
    try {
      const key = this.flashcardsConversationKeyPrefix + conversationId;
      localStorage.removeItem(key);
    } catch (error) {
      console.error('Failed to clear flashcards for conversation:', error);
    }
  }
}
