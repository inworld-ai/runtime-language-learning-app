/**
 * Memory Service
 *
 * Handles memory storage and retrieval using Supabase with pgvector.
 * Memories are stored in English with vector embeddings for semantic search.
 */
import { getSupabaseClient, isSupabaseConfigured } from '../config/supabase.js';
import { MemoryRecord, MemoryMatch, MemoryType } from '../types/memory.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('MemoryService');

/**
 * Memory Service class for storing and retrieving user memories
 */
export class MemoryService {
  /**
   * Store a new memory with its embedding
   * @param memory - The memory record to store
   * @returns The ID of the stored memory, or null if storage failed
   */
  async storeMemory(memory: MemoryRecord): Promise<string | null> {
    if (!isSupabaseConfigured()) {
      logger.debug('supabase_not_configured_skipping_store');
      return null;
    }

    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        return null;
      }

      // Format embedding for Supabase pgvector
      const embeddingStr = memory.embedding
        ? `[${memory.embedding.join(',')}]`
        : null;

      const { data, error } = await supabase
        .from('user_memories')
        .insert({
          user_id: memory.userId,
          content: memory.content,
          memory_type: memory.memoryType,
          topics: memory.topics,
          importance: memory.importance,
          embedding: embeddingStr,
        })
        .select('id')
        .single();

      if (error) {
        logger.error({ err: error }, 'failed_to_store_memory');
        return null;
      }

      logger.info(
        { memoryId: data.id, type: memory.memoryType, topics: memory.topics },
        'memory_stored'
      );
      return data.id;
    } catch (error) {
      logger.error({ err: error }, 'memory_store_exception');
      return null;
    }
  }

  /**
   * Retrieve similar memories using vector similarity search
   * @param userId - The user's ID
   * @param queryEmbedding - The embedding vector to search with
   * @param limit - Maximum number of memories to return (default: 3)
   * @param threshold - Minimum similarity threshold (default: 0.7)
   * @returns Array of matching memories with similarity scores
   */
  async retrieveMemories(
    userId: string,
    queryEmbedding: number[],
    limit: number = 3,
    threshold: number = 0.7
  ): Promise<MemoryMatch[]> {
    if (!isSupabaseConfigured()) {
      logger.debug('supabase_not_configured_skipping_retrieve');
      return [];
    }

    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        logger.warn('supabase_client_not_available');
        return [];
      }

      // Format embedding for Supabase RPC call
      const embeddingStr = `[${queryEmbedding.join(',')}]`;

      logger.info(
        { userId: userId.substring(0, 8), threshold, limit, embeddingLength: queryEmbedding.length },
        'calling_match_memories_rpc'
      );

      const { data, error } = await supabase.rpc('match_memories', {
        query_embedding: embeddingStr,
        match_user_id: userId,
        match_threshold: threshold,
        match_count: limit,
      });

      if (error) {
        logger.error({ err: error, code: error.code, message: error.message }, 'failed_to_retrieve_memories');
        return [];
      }

      logger.info({ rawDataLength: data?.length || 0 }, 'match_memories_rpc_response');

      const memories: MemoryMatch[] = (data || []).map(
        (row: {
          id: string;
          content: string;
          memory_type: string;
          topics: string[];
          importance: number;
          similarity: number;
        }) => ({
          id: row.id,
          content: row.content,
          memoryType: row.memory_type as MemoryType,
          topics: row.topics || [],
          importance: row.importance,
          similarity: row.similarity,
        })
      );

      logger.debug(
        { memoriesFound: memories.length, userId },
        'memories_retrieved'
      );

      return memories;
    } catch (error) {
      logger.error({ err: error }, 'memory_retrieve_exception');
      return [];
    }
  }

  /**
   * Get all memories for a user (for debugging/admin purposes)
   * @param userId - The user's ID
   * @param limit - Maximum number of memories to return (default: 50)
   * @returns Array of memory records
   */
  async getUserMemories(
    userId: string,
    limit: number = 50
  ): Promise<MemoryRecord[]> {
    if (!isSupabaseConfigured()) {
      return [];
    }

    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        return [];
      }

      const { data, error } = await supabase
        .from('user_memories')
        .select('id, content, memory_type, topics, importance, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        logger.error({ err: error }, 'failed_to_get_user_memories');
        return [];
      }

      return (data || []).map(
        (row: {
          id: string;
          content: string;
          memory_type: string;
          topics: string[];
          importance: number;
          created_at: string;
        }) => ({
          id: row.id,
          userId,
          content: row.content,
          memoryType: row.memory_type as MemoryType,
          topics: row.topics || [],
          importance: row.importance,
          createdAt: row.created_at,
        })
      );
    } catch (error) {
      logger.error({ err: error }, 'get_user_memories_exception');
      return [];
    }
  }

  /**
   * Delete a specific memory
   * @param memoryId - The memory ID to delete
   * @returns True if deleted successfully
   */
  async deleteMemory(memoryId: string): Promise<boolean> {
    if (!isSupabaseConfigured()) {
      return false;
    }

    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        return false;
      }

      const { error } = await supabase
        .from('user_memories')
        .delete()
        .eq('id', memoryId);

      if (error) {
        logger.error({ err: error, memoryId }, 'failed_to_delete_memory');
        return false;
      }

      logger.info({ memoryId }, 'memory_deleted');
      return true;
    } catch (error) {
      logger.error({ err: error }, 'delete_memory_exception');
      return false;
    }
  }
}

// Singleton instance
let memoryService: MemoryService | null = null;

/**
 * Get the singleton MemoryService instance
 */
export function getMemoryService(): MemoryService {
  if (!memoryService) {
    memoryService = new MemoryService();
  }
  return memoryService;
}
