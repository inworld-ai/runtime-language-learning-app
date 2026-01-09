/**
 * MemoryRetrievalNode retrieves relevant memories before prompt building.
 *
 * This node:
 * - Receives the current state with user input
 * - Embeds the user's current message
 * - Queries Supabase for similar memories using vector similarity
 * - Returns state enriched with relevant memories
 */

import { CustomNode, ProcessContext } from '@inworld/runtime/graph';
import { TextEmbedder } from '@inworld/runtime/primitives/embeddings';
import { State, StateWithMemories } from '../../types/index.js';
import { getMemoryService } from '../../services/memory-service.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { embedderConfig } from '../../config/embedder.js';
import { graphLogger as logger } from '../../utils/logger.js';

// Re-export for backwards compatibility
export type { StateWithMemories } from '../../types/index.js';

/** Maximum number of memories to retrieve */
const MEMORY_RETRIEVAL_LIMIT = 3;

/** Minimum similarity threshold for memory matches */
const MEMORY_SIMILARITY_THRESHOLD = 0.5;

// Singleton embedder - shared across all MemoryRetrievalNode instances
let sharedEmbedder: TextEmbedder | null = null;
let sharedInitPromise: Promise<void> | null = null;

/**
 * Initialize shared embedder lazily
 */
async function initSharedEmbedder(): Promise<void> {
  if (sharedEmbedder) {
    return;
  }

  if (sharedInitPromise) {
    return sharedInitPromise;
  }

  sharedInitPromise = (async () => {
    try {
      const apiKey = process.env.INWORLD_API_KEY;
      if (!apiKey) {
        throw new Error('INWORLD_API_KEY environment variable is required');
      }

      sharedEmbedder = await TextEmbedder.create({
        remoteConfig: {
          apiKey,
          provider: embedderConfig.provider,
          modelName: embedderConfig.modelName,
        },
      });
      logger.info('memory_retrieval_embedder_initialized');
    } catch (error) {
      logger.error({ err: error }, 'memory_retrieval_embedder_init_failed');
      sharedInitPromise = null; // Allow retry
      throw error;
    }
  })();

  return sharedInitPromise;
}

export class MemoryRetrievalNode extends CustomNode {
  constructor(props: { id: string; reportToClient?: boolean }) {
    super({
      id: props.id,
      reportToClient: props.reportToClient,
    });
    // Note: embedder is initialized lazily on first use, not during construction
  }

  /**
   * Cleanup method for pattern consistency with other nodes
   */
  destroy(): void {
    // Embedder is shared singleton, not destroyed per-node
  }

  async process(
    _context: ProcessContext,
    state: State
  ): Promise<StateWithMemories> {
    logger.info(
      { nodeId: this.id, hasState: !!state },
      'memory_retrieval_node_entered'
    );

    // Get user ID from state (flows through the graph from connection.state)
    const userId = state.userId;
    logger.info(
      { userId: userId?.substring(0, 8) },
      'memory_retrieval_got_userId'
    );

    // If no userId or Supabase not configured, skip memory retrieval
    if (!userId || !isSupabaseConfigured()) {
      logger.info(
        { hasUserId: !!userId, supabaseConfigured: isSupabaseConfigured() },
        'skipping_memory_retrieval'
      );
      return { ...state, relevantMemories: [] };
    }

    // Get the last user message for embedding
    const lastUserMessage = [...state.messages]
      .reverse()
      .find((m) => m.role === 'user');

    if (!lastUserMessage) {
      return { ...state, relevantMemories: [] };
    }

    try {
      logger.info(
        {
          userId: userId.substring(0, 8),
          userMessage: lastUserMessage.content.substring(0, 50),
        },
        'memory_retrieval_starting'
      );

      // Initialize embedder lazily (only when actually needed)
      await initSharedEmbedder();

      if (!sharedEmbedder) {
        logger.warn('embedder_not_available');
        return { ...state, relevantMemories: [] };
      }

      // Embed user message
      logger.debug('embedding_user_message');
      const embedResponse = await sharedEmbedder.embed(lastUserMessage.content);
      const queryEmbedding = TextEmbedder.toArray(embedResponse);
      logger.debug(
        { embeddingLength: queryEmbedding.length },
        'embedding_generated'
      );

      // Retrieve similar memories
      const memoryService = getMemoryService();
      const memories = await memoryService.retrieveMemories(
        userId,
        queryEmbedding,
        MEMORY_RETRIEVAL_LIMIT,
        MEMORY_SIMILARITY_THRESHOLD
      );

      logger.info(
        {
          memoriesFound: memories.length,
          userId: userId.substring(0, 8),
          memories: memories.map((m) => ({
            content: m.content.substring(0, 50),
            similarity: m.similarity,
          })),
        },
        'memories_retrieved_for_prompt'
      );

      return {
        ...state,
        relevantMemories: memories,
      };
    } catch (error) {
      logger.error({ err: error }, 'memory_retrieval_error');
      return { ...state, relevantMemories: [] };
    }
  }
}
