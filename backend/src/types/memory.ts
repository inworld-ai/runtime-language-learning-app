/**
 * Memory Types for Language Learning App
 *
 * Defines interfaces for user memories - used for personalized conversations.
 */

import type { State } from './index.js';

/**
 * Type of memory content
 * - learning_progress: Info about user's language learning (vocabulary, grammar, struggles)
 * - personal_context: Personal details shared by user (interests, goals, preferences)
 */
export type MemoryType = 'learning_progress' | 'personal_context';

/** Valid memory types for runtime validation */
export const VALID_MEMORY_TYPES: MemoryType[] = [
  'learning_progress',
  'personal_context',
];

/**
 * Memory record for storing in Supabase
 */
export interface MemoryRecord {
  id?: string;
  userId: string;

  // Memory content (English)
  content: string;

  // Metadata
  memoryType: MemoryType;
  topics: string[];
  importance: number; // 0.0 to 1.0

  // Embedding (1024 dimensions for BAAI/bge-large-en-v1.5)
  embedding?: number[];

  // Timestamps
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Memory match returned from similarity search
 */
export interface MemoryMatch {
  id: string;
  content: string;
  memoryType: MemoryType;
  topics: string[];
  importance: number;
  similarity: number; // Cosine similarity score (0.0 to 1.0)
}

/**
 * Raw LLM output when generating a memory
 */
export interface MemoryGenerationOutput {
  memory: string;
  type: MemoryType;
  topics: string[];
  importance: number;
}

/**
 * Input for memory creation
 */
export interface MemoryCreationInput {
  userId: string;
  messages: Array<{ role: string; content: string }>;
  languageCode: string;
}

/**
 * Input for memory retrieval
 */
export interface MemoryRetrievalInput {
  userId: string;
  queryText: string;
  limit?: number;
  threshold?: number;
}

/**
 * Extended state with relevant memories attached
 * Used by MemoryRetrievalNode and DialogPromptBuilderNode
 */
export interface StateWithMemories extends State {
  relevantMemories?: MemoryMatch[];
}

/**
 * Raw row format from Supabase user_memories table
 * Used for type-safe database row mapping
 */
export interface SupabaseMemoryRow {
  id: string;
  content: string;
  memory_type: string;
  topics: string[];
  importance: number;
  similarity?: number;
  created_at?: string;
}
