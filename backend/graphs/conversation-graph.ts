/**
 * Conversation Graph for Language Learning App - Inworld Runtime 0.9
 *
 * This is a long-running circular graph that:
 * - Processes continuous audio streams via AssemblyAI STT with built-in VAD
 * - Queues interactions for sequential processing
 * - Uses language-specific prompts and TTS voices
 * - Loops back for the next interaction automatically
 *
 * Graph Flow:
 * AudioInput → AssemblyAI STT (loop) → TranscriptExtractor → InteractionQueue
 *    → TextInput → DialogPromptBuilder → LLM → TextChunking → TTSRequestBuilder → TTS
 *    → TextAggregator → StateUpdate → (loop back to InteractionQueue)
 */

import {
  Graph,
  GraphBuilder,
  ProxyNode,
  RemoteLLMChatNode,
  RemoteTTSNode,
  TextChunkingNode,
  TextAggregatorNode,
} from '@inworld/runtime/graph';

import { AssemblyAISTTWebSocketNode } from './nodes/assembly-ai-stt-ws-node.js';
import { DialogPromptBuilderNode } from './nodes/dialog-prompt-builder-node.js';
import { InteractionQueueNode } from './nodes/interaction-queue-node.js';
import { MemoryRetrievalNode } from './nodes/memory-retrieval-node.js';
import { StateUpdateNode } from './nodes/state-update-node.js';
import { TextInputNode } from './nodes/text-input-node.js';
import { TranscriptExtractorNode } from './nodes/transcript-extractor-node.js';
import { TTSRequestBuilderNode } from './nodes/tts-request-builder-node.js';
import { ConnectionsMap, TextInput } from '../types/index.js';
import {
  getLanguageConfig,
  DEFAULT_LANGUAGE_CODE,
} from '../config/languages.js';
import { llmConfig } from '../config/llm.js';
import { serverConfig, getAssemblyAISettings } from '../config/server.js';
import { graphLogger as logger } from '../utils/logger.js';

export interface ConversationGraphConfig {
  assemblyAIApiKey: string;
  connections: ConnectionsMap;
  defaultLanguageCode?: string;
}

/**
 * Wrapper class for the conversation graph
 * Provides access to the graph and the AssemblyAI node for session management
 */
export class ConversationGraphWrapper {
  graph: Graph;
  assemblyAINode: AssemblyAISTTWebSocketNode;

  private constructor(params: {
    graph: Graph;
    assemblyAINode: AssemblyAISTTWebSocketNode;
  }) {
    this.graph = params.graph;
    this.assemblyAINode = params.assemblyAINode;
  }

  async destroy(): Promise<void> {
    await this.assemblyAINode.destroy();
    await this.graph.stop();
  }

  /**
   * Create the conversation graph
   */
  static create(config: ConversationGraphConfig): ConversationGraphWrapper {
    const {
      connections,
      assemblyAIApiKey,
      defaultLanguageCode = DEFAULT_LANGUAGE_CODE,
    } = config;
    const langConfig = getLanguageConfig(defaultLanguageCode);
    const postfix = `-lang-learning`;

    logger.info(
      { language: langConfig.name, languageCode: defaultLanguageCode },
      'creating_conversation_graph'
    );

    // ============================================================
    // Create Nodes
    // ============================================================

    // Start node (audio input proxy)
    const audioInputNode = new ProxyNode({ id: `audio-input-proxy${postfix}` });

    // AssemblyAI STT with built-in VAD (always uses multilingual model)
    const turnDetectionSettings = getAssemblyAISettings();
    const assemblyAISTTNode = new AssemblyAISTTWebSocketNode({
      id: `assembly-ai-stt-ws-node${postfix}`,
      config: {
        apiKey: assemblyAIApiKey,
        connections: connections,
        sampleRate: serverConfig.audio.inputSampleRate,
        formatTurns: serverConfig.assemblyAI.formatTurns,
        endOfTurnConfidenceThreshold:
          turnDetectionSettings.endOfTurnConfidenceThreshold,
        minEndOfTurnSilenceWhenConfident:
          turnDetectionSettings.minEndOfTurnSilenceWhenConfident,
        maxTurnSilence: turnDetectionSettings.maxTurnSilence,
      },
    });

    const transcriptExtractorNode = new TranscriptExtractorNode({
      id: `transcript-extractor-node${postfix}`,
      reportToClient: true,
    });

    const interactionQueueNode = new InteractionQueueNode({
      id: `interaction-queue-node${postfix}`,
      connections,
      reportToClient: false,
    });

    const textInputNode = new TextInputNode({
      id: `text-input-node${postfix}`,
      connections,
      reportToClient: true,
    });

    const memoryRetrievalNode = new MemoryRetrievalNode({
      id: `memory-retrieval-node${postfix}`,
      connections,
      reportToClient: false,
    });

    const dialogPromptBuilderNode = new DialogPromptBuilderNode({
      id: `dialog-prompt-builder-node${postfix}`,
      connections,
    });

    // LLM Node - uses Inworld Runtime's remote LLM
    const llmNode = new RemoteLLMChatNode({
      id: `llm-node${postfix}`,
      provider: llmConfig.conversation.provider,
      modelName: llmConfig.conversation.model,
      stream: llmConfig.conversation.stream,
      textGenerationConfig: llmConfig.conversation.textGenerationConfig,
      reportToClient: true,
    });

    const textChunkingNode = new TextChunkingNode({
      id: `text-chunking-node${postfix}`,
    });

    const textAggregatorNode = new TextAggregatorNode({
      id: `text-aggregator-node${postfix}`,
    });

    const stateUpdateNode = new StateUpdateNode({
      id: `state-update-node${postfix}`,
      connections,
      reportToClient: true,
    });

    const ttsRequestBuilderNode = new TTSRequestBuilderNode({
      id: `tts-request-builder-node${postfix}`,
      connections,
      defaultVoiceId: langConfig.ttsConfig.speakerId,
      reportToClient: false,
    });

    const ttsNode = new RemoteTTSNode({
      id: `tts-node${postfix}`,
      speakerId: langConfig.ttsConfig.speakerId,
      modelId: langConfig.ttsConfig.modelId,
      sampleRate: serverConfig.audio.ttsSampleRate,
      temperature: langConfig.ttsConfig.temperature,
      speakingRate: langConfig.ttsConfig.speakingRate,
      languageCode: langConfig.ttsConfig.languageCode,
      reportToClient: true,
    });

    // ============================================================
    // Build the Graph
    // ============================================================

    const graphBuilder = new GraphBuilder({
      id: `lang-learning-conversation-graph`,
      enableRemoteConfig: false,
    });

    graphBuilder
      // Add all nodes
      .addNode(audioInputNode)
      .addNode(assemblyAISTTNode)
      .addNode(transcriptExtractorNode)
      .addNode(interactionQueueNode)
      .addNode(textInputNode)
      .addNode(memoryRetrievalNode)
      .addNode(dialogPromptBuilderNode)
      .addNode(llmNode)
      .addNode(textChunkingNode)
      .addNode(textAggregatorNode)
      .addNode(ttsRequestBuilderNode)
      .addNode(ttsNode)
      .addNode(stateUpdateNode)

      // ============================================================
      // Audio Input Flow (STT with VAD)
      // ============================================================
      .addEdge(audioInputNode, assemblyAISTTNode)

      // AssemblyAI loops back to itself while stream is active
      .addEdge(assemblyAISTTNode, assemblyAISTTNode, {
        condition: async (input: unknown) => {
          const data = input as { stream_exhausted?: boolean };
          return data?.stream_exhausted !== true;
        },
        loop: true,
        optional: true,
      })

      // When interaction is complete, extract transcript
      .addEdge(assemblyAISTTNode, transcriptExtractorNode, {
        condition: async (input: unknown) => {
          const data = input as { interaction_complete?: boolean };
          return data?.interaction_complete === true;
        },
      })

      // Transcript goes to interaction queue
      .addEdge(transcriptExtractorNode, interactionQueueNode)

      // ============================================================
      // Processing Flow
      // ============================================================

      // InteractionQueue → TextInput only when there's text to process
      .addEdge(interactionQueueNode, textInputNode, {
        condition: (input: TextInput) => {
          return Boolean(input.text && input.text.trim().length > 0);
        },
      })

      // TextInput updates state, retrieves memories, then builds prompt
      .addEdge(textInputNode, memoryRetrievalNode)
      .addEdge(memoryRetrievalNode, dialogPromptBuilderNode)

      // Also pass state to TTS builder for voice selection
      .addEdge(textInputNode, ttsRequestBuilderNode)

      // Prompt builder → LLM
      .addEdge(dialogPromptBuilderNode, llmNode)

      // LLM output splits: one for TTS, one for state update
      .addEdge(llmNode, textChunkingNode)
      .addEdge(llmNode, textAggregatorNode)

      // Text chunking → TTS request builder → TTS
      .addEdge(textChunkingNode, ttsRequestBuilderNode)
      .addEdge(ttsRequestBuilderNode, ttsNode)

      // Text aggregator → state update
      .addEdge(textAggregatorNode, stateUpdateNode)

      // ============================================================
      // Loop Back
      // ============================================================

      // State update loops back to interaction queue for next turn
      .addEdge(stateUpdateNode, interactionQueueNode, {
        loop: true,
        optional: true,
      })

      // ============================================================
      // Start and End Nodes
      // ============================================================
      .setStartNode(audioInputNode)
      .setEndNode(ttsNode);

    const graph = graphBuilder.build();

    logger.info('conversation_graph_built');

    return new ConversationGraphWrapper({
      graph,
      assemblyAINode: assemblyAISTTNode,
    });
  }
}

// Cache for the conversation graph wrapper instance
let conversationGraphWrapper: ConversationGraphWrapper | null = null;

/**
 * Get or create the conversation graph wrapper
 */
export function getConversationGraph(
  config: ConversationGraphConfig
): ConversationGraphWrapper {
  if (!conversationGraphWrapper) {
    logger.info('creating_conversation_graph_wrapper');
    conversationGraphWrapper = ConversationGraphWrapper.create(config);
  }
  return conversationGraphWrapper;
}

/**
 * Destroy the conversation graph wrapper and clear the cache
 */
export async function destroyConversationGraph(): Promise<void> {
  if (conversationGraphWrapper) {
    await conversationGraphWrapper.destroy();
    conversationGraphWrapper = null;
  }
}
