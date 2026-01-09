import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Flashcard,
  ConversationSummary,
  ConversationData,
  ConversationMessage,
} from '../types';

export class SupabaseStorage {
  private supabase: SupabaseClient;
  private userId: string;

  constructor(supabase: SupabaseClient, userId: string) {
    this.supabase = supabase;
    this.userId = userId;
  }

  // User preferences

  async getLanguage(): Promise<string> {
    const { data } = await this.supabase
      .from('user_preferences')
      .select('language_code')
      .eq('user_id', this.userId)
      .maybeSingle();
    return data?.language_code ?? 'es';
  }

  async saveLanguage(languageCode: string): Promise<void> {
    await this.supabase.from('user_preferences').upsert(
      {
        user_id: this.userId,
        language_code: languageCode,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
  }

  // Conversations

  async getConversationList(
    languageCode: string
  ): Promise<ConversationSummary[]> {
    const { data } = await this.supabase
      .from('conversations')
      .select('id, title, language_code, created_at, updated_at')
      .eq('user_id', this.userId)
      .eq('language_code', languageCode)
      .order('updated_at', { ascending: false });

    return (data ?? []).map((c) => ({
      id: c.id,
      title: c.title,
      languageCode: c.language_code,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    }));
  }

  async getAllConversations(): Promise<ConversationSummary[]> {
    const { data } = await this.supabase
      .from('conversations')
      .select('id, title, language_code, created_at, updated_at')
      .eq('user_id', this.userId)
      .order('updated_at', { ascending: false });

    return (data ?? []).map((c) => ({
      id: c.id,
      title: c.title,
      languageCode: c.language_code,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    }));
  }

  async getConversation(
    conversationId: string
  ): Promise<ConversationData | null> {
    const { data: messages } = await this.supabase
      .from('conversation_messages')
      .select('role, content, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (!messages) return null;

    return {
      id: conversationId,
      messages: messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: m.created_at,
      })),
    };
  }

  async saveConversation(
    conversationId: string,
    messages: ConversationMessage[],
    _languageCode: string
  ): Promise<void> {
    // Delete existing messages for this conversation
    await this.supabase
      .from('conversation_messages')
      .delete()
      .eq('conversation_id', conversationId);

    // Insert new messages
    if (messages.length > 0) {
      await this.supabase.from('conversation_messages').insert(
        messages.map((m) => ({
          conversation_id: conversationId,
          role: m.role,
          content: m.content,
          created_at: m.timestamp || new Date().toISOString(),
        }))
      );
    }

    // Update conversation's updated_at
    await this.supabase
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId);
  }

  async createConversation(
    languageCode: string,
    title: string,
    id?: string
  ): Promise<ConversationSummary> {
    const now = new Date().toISOString();
    const insertData: Record<string, unknown> = {
      user_id: this.userId,
      language_code: languageCode,
      title,
      created_at: now,
      updated_at: now,
    };

    // Use provided ID if given (to match localStorage ID)
    if (id) {
      insertData.id = id;

      // Check if conversation already exists
      const { data: existing } = await this.supabase
        .from('conversations')
        .select('id, title, language_code, created_at, updated_at')
        .eq('id', id)
        .maybeSingle();

      if (existing) {
        return {
          id: existing.id,
          title: existing.title,
          languageCode: existing.language_code,
          createdAt: existing.created_at,
          updatedAt: existing.updated_at,
        };
      }
    }

    const { data, error } = await this.supabase
      .from('conversations')
      .insert(insertData)
      .select('id, title, language_code, created_at, updated_at')
      .single();

    if (error || !data) {
      throw new Error(`Failed to create conversation: ${error?.message}`);
    }

    return {
      id: data.id,
      title: data.title,
      languageCode: data.language_code,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  async deleteConversation(conversationId: string): Promise<void> {
    // Messages will be cascade deleted
    await this.supabase.from('conversations').delete().eq('id', conversationId);
  }

  async renameConversation(
    conversationId: string,
    newTitle: string
  ): Promise<void> {
    await this.supabase
      .from('conversations')
      .update({ title: newTitle, updated_at: new Date().toISOString() })
      .eq('id', conversationId);
  }

  // Flashcards

  async getFlashcards(languageCode: string): Promise<Flashcard[]> {
    const { data } = await this.supabase
      .from('flashcards')
      .select('*')
      .eq('user_id', this.userId)
      .eq('language_code', languageCode)
      .order('created_at', { ascending: false })
      .limit(100);

    return (data ?? []).map((f) => ({
      targetWord: f.target_word,
      english: f.english,
      example: f.example,
      mnemonic: f.mnemonic,
      timestamp: f.created_at,
      languageCode: f.language_code,
    }));
  }

  async addFlashcards(
    flashcards: Flashcard[],
    languageCode: string
  ): Promise<void> {
    const toInsert = flashcards.map((f) => ({
      user_id: this.userId,
      language_code: languageCode,
      target_word: f.targetWord || f.spanish || '',
      english: f.english,
      example: f.example,
      mnemonic: f.mnemonic,
    }));

    // Use upsert to handle duplicates gracefully
    await this.supabase
      .from('flashcards')
      .upsert(toInsert, { onConflict: 'user_id,language_code,target_word' });
  }

  async clearFlashcards(languageCode: string): Promise<void> {
    await this.supabase
      .from('flashcards')
      .delete()
      .eq('user_id', this.userId)
      .eq('language_code', languageCode);
  }

  // Per-conversation flashcard methods
  async getFlashcardsForConversation(
    conversationId: string
  ): Promise<Flashcard[]> {
    const { data } = await this.supabase
      .from('flashcards')
      .select('*')
      .eq('user_id', this.userId)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(100);

    return (data ?? []).map((f) => ({
      targetWord: f.target_word,
      english: f.english,
      example: f.example,
      mnemonic: f.mnemonic,
      timestamp: f.created_at,
      languageCode: f.language_code,
      conversationId: f.conversation_id,
    }));
  }

  async addFlashcardsForConversation(
    conversationId: string,
    flashcards: Flashcard[],
    languageCode: string
  ): Promise<void> {
    const toInsert = flashcards.map((f) => ({
      user_id: this.userId,
      conversation_id: conversationId,
      language_code: languageCode,
      target_word: f.targetWord || f.spanish || '',
      english: f.english,
      example: f.example,
      mnemonic: f.mnemonic,
    }));

    // Use upsert to handle duplicates gracefully
    await this.supabase
      .from('flashcards')
      .upsert(toInsert, { onConflict: 'user_id,conversation_id,target_word' });
  }

  async clearFlashcardsForConversation(conversationId: string): Promise<void> {
    await this.supabase
      .from('flashcards')
      .delete()
      .eq('user_id', this.userId)
      .eq('conversation_id', conversationId);
  }
}
