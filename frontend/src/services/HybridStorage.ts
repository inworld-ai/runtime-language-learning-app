import type { SupabaseClient } from '@supabase/supabase-js';
import { Storage } from './Storage';
import { SupabaseStorage } from './SupabaseStorage';
import type {
  Flashcard,
  ConversationSummary,
  ConversationMessage,
} from '../types';

export class HybridStorage extends Storage {
  private supabaseStorage: SupabaseStorage | null = null;
  private syncInProgress = false;

  setSupabaseClient(supabase: SupabaseClient, userId: string): void {
    this.supabaseStorage = new SupabaseStorage(supabase, userId);
  }

  clearSupabaseClient(): void {
    this.supabaseStorage = null;
  }

  isSupabaseConnected(): boolean {
    return this.supabaseStorage !== null;
  }

  // Override methods to sync with Supabase

  override saveLanguage(languageCode: string): void {
    super.saveLanguage(languageCode);
    this.supabaseStorage?.saveLanguage(languageCode).catch(console.error);
  }

  override saveConversation(
    conversationId: string,
    messages: ConversationMessage[],
    languageCode: string
  ): void {
    super.saveConversation(conversationId, messages, languageCode);
    this.supabaseStorage
      ?.saveConversation(conversationId, messages, languageCode)
      .catch(console.error);
  }

  override createConversation(languageCode: string): ConversationSummary {
    const summary = super.createConversation(languageCode);
    // Sync to Supabase using the same ID as localStorage
    this.supabaseStorage
      ?.createConversation(languageCode, summary.title, summary.id)
      .catch(console.error);
    return summary;
  }

  override deleteConversation(conversationId: string, languageCode: string): void {
    super.deleteConversation(conversationId, languageCode);
    this.supabaseStorage?.deleteConversation(conversationId).catch(console.error);
  }

  override renameConversation(conversationId: string, newTitle: string, languageCode: string): void {
    super.renameConversation(conversationId, newTitle, languageCode);
    this.supabaseStorage?.renameConversation(conversationId, newTitle).catch(console.error);
  }

  override addFlashcards(newFlashcards: Flashcard[], languageCode: string): Flashcard[] {
    const result = super.addFlashcards(newFlashcards, languageCode);
    this.supabaseStorage
      ?.addFlashcards(newFlashcards, languageCode)
      .catch(console.error);
    return result;
  }

  override clearFlashcards(languageCode: string): void {
    super.clearFlashcards(languageCode);
    this.supabaseStorage?.clearFlashcards(languageCode).catch(console.error);
  }

  // Per-conversation flashcard methods
  override addFlashcardsForConversation(
    conversationId: string,
    newFlashcards: Flashcard[],
    languageCode: string
  ): Flashcard[] {
    const result = super.addFlashcardsForConversation(conversationId, newFlashcards, languageCode);
    this.supabaseStorage
      ?.addFlashcardsForConversation(conversationId, newFlashcards, languageCode)
      .catch(console.error);
    return result;
  }

  override clearFlashcardsForConversation(conversationId: string): void {
    super.clearFlashcardsForConversation(conversationId);
    this.supabaseStorage?.clearFlashcardsForConversation(conversationId).catch(console.error);
  }

  // Migration: upload localStorage data to Supabase
  async migrateToSupabase(languages: string[]): Promise<void> {
    if (!this.supabaseStorage || this.syncInProgress) return;

    this.syncInProgress = true;
    try {
      // Migrate language preference
      const language = this.getLanguage();
      await this.supabaseStorage.saveLanguage(language);

      // Migrate conversations and flashcards for each language
      for (const lang of languages) {
        // Migrate conversations
        const conversations = super.getConversationList(lang);
        for (const conv of conversations) {
          try {
            // Create conversation in Supabase using the SAME ID as localStorage
            await this.supabaseStorage.createConversation(
              lang,
              conv.title,
              conv.id // Pass the local ID to use in Supabase
            );

            // Get messages and save to Supabase
            const data = super.getConversation(conv.id);
            if (data && data.messages.length > 0) {
              await this.supabaseStorage.saveConversation(
                conv.id,
                data.messages,
                lang
              );
            }
          } catch (e) {
            // Conversation might already exist, that's OK
            console.log(`Conversation ${conv.id} may already exist:`, e);
          }
        }

        // Migrate flashcards
        const flashcards = super.getFlashcards(lang);
        if (flashcards.length > 0) {
          await this.supabaseStorage.addFlashcards(flashcards, lang);
        }
      }

      console.log('Migration to Supabase complete');
    } finally {
      this.syncInProgress = false;
    }
  }

  // Sync: merge Supabase data with localStorage (on login)
  // This preserves any anonymous conversations while also loading cloud data
  async syncFromSupabase(languages: string[]): Promise<{
    conversations: Map<string, ConversationSummary[]>;
    flashcards: Map<string, Flashcard[]>;
  }> {
    if (!this.supabaseStorage) {
      return { conversations: new Map(), flashcards: new Map() };
    }

    const conversations = new Map<string, ConversationSummary[]>();
    const flashcards = new Map<string, Flashcard[]>();

    try {
      // Sync conversations and flashcards for each language
      for (const lang of languages) {
        // Get both remote and local conversations
        const remoteConversations =
          await this.supabaseStorage.getConversationList(lang);
        const localConversations = super.getConversationList(lang);

        // Merge: remote conversations + local conversations not in remote
        const remoteIds = new Set(remoteConversations.map((c) => c.id));
        const localOnly = localConversations.filter((c) => !remoteIds.has(c.id));
        const merged = [...remoteConversations, ...localOnly];

        // Sort by updatedAt descending
        merged.sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );

        conversations.set(lang, merged);

        // Save merged list to localStorage
        try {
          localStorage.setItem(
            `aprende-conversations-${lang}`,
            JSON.stringify(merged)
          );

          // Load remote conversation messages to localStorage
          for (const conv of remoteConversations) {
            const data = await this.supabaseStorage.getConversation(conv.id);
            if (data) {
              localStorage.setItem(
                `aprende-conversation-${conv.id}`,
                JSON.stringify(data)
              );
            }
          }
        } catch (e) {
          console.error('Failed to sync conversations to localStorage:', e);
        }

        // Merge flashcards: combine remote + local, deduplicate by targetWord
        const remoteFlashcards = await this.supabaseStorage.getFlashcards(lang);
        const localFlashcards = super.getFlashcards(lang);

        const seenWords = new Set<string>();
        const mergedFlashcards: Flashcard[] = [];

        // Remote flashcards take priority
        for (const f of remoteFlashcards) {
          const word = (f.targetWord || '').toLowerCase();
          if (!seenWords.has(word)) {
            seenWords.add(word);
            mergedFlashcards.push(f);
          }
        }
        // Add local flashcards not in remote
        for (const f of localFlashcards) {
          const word = (f.targetWord || '').toLowerCase();
          if (!seenWords.has(word)) {
            seenWords.add(word);
            mergedFlashcards.push(f);
          }
        }

        flashcards.set(lang, mergedFlashcards);
        super.saveFlashcards(mergedFlashcards, lang);
      }

      console.log('Sync from Supabase complete (merged with local data)');
    } catch (e) {
      console.error('Failed to sync from Supabase:', e);
    }

    return { conversations, flashcards };
  }

}
