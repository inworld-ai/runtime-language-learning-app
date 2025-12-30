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

import { AssemblyAISTTWebSocketNode } from './nodes/assembly_ai_stt_ws_node.js';
import { DialogPromptBuilderNode } from './nodes/dialog_prompt_builder_node.js';
import { InteractionQueueNode } from './nodes/interaction_queue_node.js';
import { StateUpdateNode } from './nodes/state_update_node.js';
import { TextInputNode } from './nodes/text_input_node.js';
import { TranscriptExtractorNode } from './nodes/transcript_extractor_node.js';
import { TTSRequestBuilderNode } from './nodes/tts_request_builder_node.js';
import {
  ConnectionsMap,
  TextInput,
  INPUT_SAMPLE_RATE,
  TTS_SAMPLE_RATE,
} from '../types/index.js';
import {
  getLanguageConfig,
  DEFAULT_LANGUAGE_CODE,
} from '../config/languages.js';
import { getAssemblyAISettingsForEagerness } from '../types/settings.js';

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

    console.log(
      `[ConversationGraph] Creating graph for ${langConfig.name} (${defaultLanguageCode})`
    );

    // ============================================================
    // Create Nodes
    // ============================================================

    // Start node (audio input proxy)
    const audioInputNode = new ProxyNode({ id: `audio-input-proxy${postfix}` });

    // AssemblyAI STT with built-in VAD
    const turnDetectionSettings = getAssemblyAISettingsForEagerness('high');
    const assemblyAISTTNode = new AssemblyAISTTWebSocketNode({
      id: `assembly-ai-stt-ws-node${postfix}`,
      config: {
        apiKey: assemblyAIApiKey,
        connections: connections,
        sampleRate: INPUT_SAMPLE_RATE,
        formatTurns: true,
        endOfTurnConfidenceThreshold:
          turnDetectionSettings.endOfTurnConfidenceThreshold,
        minEndOfTurnSilenceWhenConfident:
          turnDetectionSettings.minEndOfTurnSilenceWhenConfident,
        maxTurnSilence: turnDetectionSettings.maxTurnSilence,
        language: defaultLanguageCode.split('-')[0], // 'es' from 'es-MX'
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

    const dialogPromptBuilderNode = new DialogPromptBuilderNode({
      id: `dialog-prompt-builder-node${postfix}`,
      connections,
    });

    // LLM Node - uses Inworld Runtime's remote LLM
    const llmNode = new RemoteLLMChatNode({
      id: `llm-node${postfix}`,
      provider: 'openai',
      modelName: 'gpt-4o-mini',
      stream: true,
      textGenerationConfig: {
        maxNewTokens: 250,
        maxPromptLength: 2000,
        temperature: 1,
        topP: 1,
        repetitionPenalty: 1,
        frequencyPenalty: 0,
        presencePenalty: 0,
      },
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
      sampleRate: TTS_SAMPLE_RATE,
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

      // TextInput updates state and passes to prompt builder
      .addEdge(textInputNode, dialogPromptBuilderNode)

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

    console.log('[ConversationGraph] Graph built successfully');

    return new ConversationGraphWrapper({
      graph,
      assemblyAINode: assemblyAISTTNode,
    });
  }
}

/**
 * Legacy export for backwards compatibility during migration
 */
export function getConversationGraph(
  _config: { apiKey: string },
  _languageCode: string = DEFAULT_LANGUAGE_CODE
): Graph {
  console.warn(
    '[ConversationGraph] getConversationGraph is deprecated. Use ConversationGraphWrapper.create() instead.'
  );
  // This won't work properly without connections, but maintains API compatibility
  return null as unknown as Graph;
}
