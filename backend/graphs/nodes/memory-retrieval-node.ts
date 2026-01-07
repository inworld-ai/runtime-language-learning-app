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
import { State, ConnectionsMap } from '../../types/index.js';
import { MemoryMatch } from '../../types/memory.js';
import { getMemoryService } from '../../services/memory-service.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { embedderConfig } from '../../config/embedder.js';
import { graphLogger as logger } from '../../utils/logger.js';

/**
 * Extended state with relevant memories
 */
export interface StateWithMemories extends State {
  relevantMemories?: MemoryMatch[];
}

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
      sharedEmbedder = await TextEmbedder.create({
        remoteConfig: {
          apiKey: process.env.INWORLD_API_KEY!,
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
  constructor(props: {
    id: string;
    connections: ConnectionsMap;
    reportToClient?: boolean;
  }) {
    super({
      id: props.id,
      reportToClient: props.reportToClient,
    });
    logger.info({ nodeId: props.id }, 'memory_retrieval_node_constructed');
    // Note: embedder is initialized lazily on first use, not during construction
  }

  async process(
    context: ProcessContext,
    state: State
  ): Promise<StateWithMemories> {
    logger.info({ nodeId: this.id, hasState: !!state }, 'memory_retrieval_node_entered');

    // Get user ID from state (flows through the graph from connection.state)
    const userId = state.userId;
    logger.info({ userId: userId?.substring(0, 8) }, 'memory_retrieval_got_userId');

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
        { userId: userId.substring(0, 8), userMessage: lastUserMessage.content.substring(0, 50) },
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
      logger.debug({ embeddingLength: queryEmbedding.length }, 'embedding_generated');

      // Retrieve similar memories
      const memoryService = getMemoryService();
      const memories = await memoryService.retrieveMemories(
        userId,
        queryEmbedding,
        3, // limit: up to 3 memories
        0.5 // threshold: lowered from 0.65 for testing
      );

      logger.info(
        {
          memoriesFound: memories.length,
          userId: userId.substring(0, 8),
          memories: memories.map(m => ({ content: m.content.substring(0, 50), similarity: m.similarity }))
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
