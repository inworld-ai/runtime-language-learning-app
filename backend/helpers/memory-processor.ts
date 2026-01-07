/**
 * Memory Processor
 *
 * Generates, embeds, and stores memories from conversations.
 * Designed for non-blocking (fire-and-forget) execution.
 *
 * Features:
 * - Turn counting to trigger memory creation every N turns
 * - LLM-based memory generation from conversation context
 * - Embedding generation using BAAI/bge-large-en-v1.5
 * - Storage in Supabase with pgvector
 */

import { v4 as uuidv4 } from 'uuid';
import { Graph } from '@inworld/runtime/graph';
import { TextEmbedder } from '@inworld/runtime/primitives/embeddings';
import { getMemoryService } from '../services/memory-service.js';
import { isSupabaseConfigured } from '../config/supabase.js';
import { embedderConfig } from '../config/embedder.js';
import { createMemoryGenerationGraph } from '../graphs/memory-generation-graph.js';
import {
  getLanguageConfig,
  DEFAULT_LANGUAGE_CODE,
} from '../config/languages.js';
import {
  MemoryRecord,
  MemoryType,
  MemoryGenerationOutput,
} from '../types/memory.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('MemoryProcessor');

/** Number of recent messages to include for memory generation context */
const MEMORY_MESSAGE_CONTEXT_LIMIT = 10;

// Singleton graph instance - shared across all MemoryProcessor instances
let sharedGraph: Graph | null = null;
let sharedEmbedder: TextEmbedder | null = null;
let sharedInitPromise: Promise<void> | null = null;

/**
 * Initialize shared resources (graph and embedder) - called lazily
 */
async function initSharedResources(): Promise<void> {
  if (sharedGraph && sharedEmbedder) {
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

      // Initialize embedder
      sharedEmbedder = await TextEmbedder.create({
        remoteConfig: {
          apiKey,
          provider: embedderConfig.provider,
          modelName: embedderConfig.modelName,
        },
      });

      // Initialize memory generation graph
      sharedGraph = createMemoryGenerationGraph();

      logger.info('memory_processor_initialized');
    } catch (error) {
      logger.error({ err: error }, 'memory_processor_init_failed');
      sharedInitPromise = null; // Allow retry
      throw error;
    }
  })();

  return sharedInitPromise;
}

/**
 * Memory Processor class for generating and storing user memories
 */
export class MemoryProcessor {
  private turnCount: number = 0;
  private readonly turnInterval: number = 3;
  private languageCode: string = DEFAULT_LANGUAGE_CODE;

  constructor(languageCode: string = DEFAULT_LANGUAGE_CODE) {
    this.languageCode = languageCode;
    logger.info('memory_processor_created');
  }

  /**
   * Update the language for this processor
   */
  setLanguage(languageCode: string): void {
    if (this.languageCode !== languageCode) {
      this.languageCode = languageCode;
      logger.debug({ languageCode }, 'memory_processor_language_changed');
    }
  }

  /**
   * Increment turn count - call after each completed turn
   */
  incrementTurn(): void {
    this.turnCount++;
    logger.debug({ turnCount: this.turnCount }, 'memory_turn_incremented');
  }

  /**
   * Check if we should create a memory this turn
   */
  shouldCreateMemory(): boolean {
    return this.turnCount > 0 && this.turnCount % this.turnInterval === 0;
  }

  /**
   * Get current turn count
   */
  getTurnCount(): number {
    return this.turnCount;
  }

  /**
   * Non-blocking memory creation (fire-and-forget)
   * Call this without awaiting to not block the conversation
   */
  createMemoryAsync(
    userId: string,
    messages: Array<{ role: string; content: string }>
  ): void {
    // Fire and forget - don't await in calling code
    this.processMemoryCreation(userId, messages).catch((error) => {
      logger.error({ err: error }, 'memory_creation_failed');
    });
  }

  /**
   * Internal method to process memory creation
   */
  private async processMemoryCreation(
    userId: string,
    messages: Array<{ role: string; content: string }>
  ): Promise<void> {
    if (!isSupabaseConfigured()) {
      logger.debug('supabase_not_configured_skipping_memory_creation');
      return;
    }

    // Initialize shared resources lazily (only when first memory is created)
    await initSharedResources();

    if (!sharedGraph || !sharedEmbedder) {
      logger.warn('memory_processor_not_ready');
      return;
    }

    try {
      const langConfig = getLanguageConfig(this.languageCode);

      // Step 1: Generate memory using LLM
      const input = {
        messages: messages.slice(-MEMORY_MESSAGE_CONTEXT_LIMIT),
        target_language: langConfig.name,
      };

      const executionResult = await sharedGraph.start(input, {
        executionId: uuidv4(),
      });

      let llmOutput: string = '';
      for await (const res of executionResult.outputStream) {
        if (res.data) {
          // Extract content from LLM response
          const data = res.data as { content?: string } | string;
          llmOutput = typeof data === 'string' ? data : data.content || '';
        }
      }

      if (!llmOutput) {
        logger.warn('no_llm_output_for_memory');
        return;
      }

      // Step 2: Parse JSON response
      const memoryData = this.parseMemoryOutput(llmOutput);
      if (!memoryData || !memoryData.memory) {
        logger.debug(
          { llmOutput: llmOutput.substring(0, 100) },
          'no_valid_memory_generated'
        );
        return;
      }

      // Step 3: Generate embedding for the memory text
      const embedResponse = await sharedEmbedder.embed(memoryData.memory);
      const embedding = TextEmbedder.toArray(embedResponse);

      // Step 4: Store memory in Supabase
      const memoryRecord: MemoryRecord = {
        userId,
        content: memoryData.memory,
        memoryType: memoryData.type,
        topics: memoryData.topics,
        importance: memoryData.importance,
        embedding,
      };

      const memoryService = getMemoryService();
      const memoryId = await memoryService.storeMemory(memoryRecord);

      if (memoryId) {
        logger.info(
          {
            memoryId,
            type: memoryData.type,
            topics: memoryData.topics,
            importance: memoryData.importance,
          },
          'memory_created_successfully'
        );
      }
    } catch (error) {
      logger.error({ err: error }, 'memory_processing_error');
    }
  }

  /**
   * Parse LLM output to extract memory data
   */
  private parseMemoryOutput(llmOutput: string): MemoryGenerationOutput | null {
    try {
      // Find JSON in the output
      const jsonMatch = llmOutput.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate required fields
      if (!parsed.memory || typeof parsed.memory !== 'string') {
        return null;
      }

      // Empty memory means nothing memorable
      if (parsed.memory.trim() === '') {
        return null;
      }

      // Validate and normalize type
      const validTypes: MemoryType[] = [
        'learning_progress',
        'personal_context',
      ];
      const type: MemoryType = validTypes.includes(parsed.type)
        ? parsed.type
        : 'personal_context';

      // Validate topics
      const topics: string[] = Array.isArray(parsed.topics)
        ? parsed.topics
            .filter((t: unknown) => typeof t === 'string')
            .slice(0, 5)
        : [];

      // Validate importance
      const importance =
        typeof parsed.importance === 'number'
          ? Math.max(0, Math.min(1, parsed.importance))
          : 0.5;

      return {
        memory: parsed.memory.trim(),
        type,
        topics,
        importance,
      };
    } catch (error) {
      logger.error(
        { err: error, output: llmOutput.substring(0, 100) },
        'memory_parse_error'
      );
      return null;
    }
  }

  /**
   * Reset the processor (e.g., when starting a new conversation)
   */
  reset(): void {
    this.turnCount = 0;
  }
}
