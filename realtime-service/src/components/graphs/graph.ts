import {
  Graph,
  GraphBuilder,
  ProxyNode,
  RemoteLLMChatNode,
  RemoteTTSNode,
  FakeTTSComponent,
  TextAggregatorNode,
  TextChunkingNode, FakeRemoteLLMComponent,
  RemoteLLMChatRoutingNode  // TODO: Create GraphTypes.LLMChatRoutingRequest and use remoteLLMChatRoutingNode instead
} from '@inworld/runtime/graph';
import * as os from 'os';
import * as path from 'path';
import logger from '../../logger';

import {
  INPUT_SAMPLE_RATE,
  TTS_SAMPLE_RATE,
} from '../../config';
import { CreateGraphPropsInterface, State, TextInput } from '../../types/index';
import { getAssemblyAISettingsForEagerness } from '../../types/settings';
import { AssemblyAISTTWebSocketNode } from './nodes/assembly_ai_stt_ws_node';
import { DialogPromptBuilderNode } from './nodes/dialog_prompt_builder_node';
import { InteractionQueueNode } from './nodes/interaction_queue_node';
import { StateUpdateNode } from './nodes/state_update_node';
import { TextInputNode } from './nodes/text_input_node';
import { TranscriptExtractorNode } from './nodes/transcript_extractor_node';
import { TTSRequestBuilderNode } from './nodes/tts_request_builder_node';

export class InworldGraphWrapper {
  graph: Graph;
  assemblyAINode: AssemblyAISTTWebSocketNode;

  private constructor({ graph, assemblyAINode }: { graph: Graph; assemblyAINode: AssemblyAISTTWebSocketNode }) {
    this.graph = graph;
    this.assemblyAINode = assemblyAINode;
  }

  async destroy() {
    await this.graph.stop();
  }

  static async create(props: CreateGraphPropsInterface) {
    const {
      llmModelName,
      llmProvider,
      voiceId,
      connections,
      ttsModelId,
      useMocks = false,
    } = props;

    const postfix = `-multimodal`;

    const dialogPromptBuilderNode = new DialogPromptBuilderNode({
      id: `dialog-prompt-builder-node${postfix}`,
    });

    const textInputNode = new TextInputNode({
      id: `text-input-node${postfix}`,
      connections,
      reportToClient: true,
    });

    const llmNode = new RemoteLLMChatNode({
      id: `llm-node${postfix}`,
      provider: llmProvider,
      modelName: llmModelName,
      stream: true,
      textGenerationConfig: {
        maxNewTokens: 320
      },
      reportToClient: true,
      ...(useMocks && {
        llmComponent: new FakeRemoteLLMComponent({
          id: `llm-component${postfix}`,
          modelName: llmModelName,
          provider: llmProvider,
        }),
      }),
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
      defaultVoiceId: voiceId,
      reportToClient: false,
    });

    const ttsNode = new RemoteTTSNode({
      id: `tts-node${postfix}`,
      speakerId: voiceId,
      modelId: ttsModelId,
      sampleRate: TTS_SAMPLE_RATE,
      temperature: 1.1,
      speakingRate: 1,
      reportToClient: true,
      ...(useMocks && {
        ttsComponent: new FakeTTSComponent({
          id: `tts-component-${postfix}`,
          loadTestConfig: {
            firstChunkDelay: 200,
            sampleRate: 48000,
            errorProbability: 0.0,
            chunksPerRequest: 20,
            interChunkDelay: 100,
            collectMetrics: true,
          },
        }),
      }),
    });

    // A second branch that only executes text chunking - we will not execute TTS when output_modality doesn't contain audio
    const dialogPromptBuilderNodeTextOnly = new DialogPromptBuilderNode({
      id: `dialog-prompt-builder-node-text-only${postfix}`,
    });

    const textChunkingNodeTextOnly = new TextChunkingNode({
      id: `text-chunking-node-text-only${postfix}`,
      reportToClient: true,
    });

    const llmNodeTextOnly = new RemoteLLMChatNode({
      id: `llm-node-text-only${postfix}`,
      provider: llmProvider,
      modelName: llmModelName,
      stream: true,
      textGenerationConfig: { maxNewTokens: 320 },
      reportToClient: true,
      ...(useMocks && {
        llmComponent: new FakeRemoteLLMComponent({
          id: `llm-component-text-only${postfix}`,
          modelName: llmModelName,
          provider: llmProvider,
        }),
      }),
    });

    const textAggregatorNodeTextOnly = new TextAggregatorNode({
      id: `text-aggregator-node-text-only${postfix}`,
    });

    const stateUpdateNodeTextOnly = new StateUpdateNode({
      id: `state-update-node-text-only${postfix}`,
      connections,
      reportToClient: true,
    });
    // End of the text only branch

    const graphName = `voice-agent${postfix}`;
    const graphBuilder = new GraphBuilder({
      id: graphName,
      enableRemoteConfig: false,
    });

    graphBuilder
      .addNode(textInputNode)
      .addNode(dialogPromptBuilderNode)
      .addNode(llmNode)
      .addNode(textChunkingNode)
      .addNode(textAggregatorNode)
      .addNode(ttsRequestBuilderNode)
      .addNode(ttsNode)
      .addNode(stateUpdateNode)
      .addEdge(textInputNode, dialogPromptBuilderNode, {
        condition: async (input: State) => {
          return input?.output_modalities.includes("audio")
        },
      })
      .addEdge(dialogPromptBuilderNode, llmNode)
      .addEdge(llmNode, textChunkingNode)
      .addEdge(textInputNode, ttsRequestBuilderNode, {
        condition: async (input: State) => {
          return input?.output_modalities.includes("audio")
        },
      })
      .addEdge(textChunkingNode, ttsRequestBuilderNode)
      .addEdge(ttsRequestBuilderNode, ttsNode)
      .addEdge(llmNode, textAggregatorNode)
      .addEdge(textAggregatorNode, stateUpdateNode)
      // Text-only outputs nodes/edges
      .addNode(dialogPromptBuilderNodeTextOnly)
      .addNode(textChunkingNodeTextOnly)
      .addNode(llmNodeTextOnly)
      .addNode(textAggregatorNodeTextOnly)
      .addNode(stateUpdateNodeTextOnly)
      .addEdge(textInputNode, dialogPromptBuilderNodeTextOnly, {
        condition: async (input: State) => {
          return !input?.output_modalities.includes("audio") && input?.output_modalities.includes("text")
        },
      })
      .addEdge(dialogPromptBuilderNodeTextOnly, llmNodeTextOnly)
      .addEdge(llmNodeTextOnly, textChunkingNodeTextOnly)
      .addEdge(llmNodeTextOnly, textAggregatorNodeTextOnly)
      .addEdge(textAggregatorNodeTextOnly, stateUpdateNodeTextOnly)
      ;


    // Validate configuration
    if (!props.assemblyAIApiKey) {
      throw new Error('Assembly.AI API key is required for audio input');
    }

    logger.info('Building graph with Multimodal pipeline');

    // Start node to pass the audio input to Assembly.AI STT
    const audioInputNode = new ProxyNode();
    const interactionQueueNode = new InteractionQueueNode({
      id: `interaction-queue-node${postfix}`,
      connections,
      reportToClient: false,
    });

    // Get eagerness settings from connection state, default to 'medium'
    const connection = connections[Object.keys(connections)[0]];
    const eagerness = connection?.state?.eagerness || 'medium';
    const turnDetectionSettings = getAssemblyAISettingsForEagerness(eagerness);

    logger.info({
      eagerness,
      profile: turnDetectionSettings.description,
      endOfTurnConfidenceThreshold: turnDetectionSettings.endOfTurnConfidenceThreshold,
      minEndOfTurnSilenceWhenConfident: turnDetectionSettings.minEndOfTurnSilenceWhenConfident,
      maxTurnSilence: turnDetectionSettings.maxTurnSilence,
    }, `Configured eagerness: ${eagerness} (${turnDetectionSettings.description})`);

    const assemblyAISTTNode = new AssemblyAISTTWebSocketNode({
      id: `assembly-ai-stt-ws-node${postfix}`,
      config: {
        apiKey: props.assemblyAIApiKey!,
        connections: connections,
        sampleRate: INPUT_SAMPLE_RATE,
        formatTurns: false,
        endOfTurnConfidenceThreshold: turnDetectionSettings.endOfTurnConfidenceThreshold,
        minEndOfTurnSilenceWhenConfident: turnDetectionSettings.minEndOfTurnSilenceWhenConfident,
        maxTurnSilence: turnDetectionSettings.maxTurnSilence,
      },
    });

    const transcriptExtractorNode = new TranscriptExtractorNode({
      id: `transcript-extractor-node${postfix}`,
      reportToClient: true,
    });

    graphBuilder
      .addNode(audioInputNode)
      .addNode(assemblyAISTTNode)
      .addNode(transcriptExtractorNode)
      .addNode(interactionQueueNode)
      .addEdge(audioInputNode, assemblyAISTTNode)
      .addEdge(assemblyAISTTNode, assemblyAISTTNode, {
        condition: async (input: any) => {
          return input?.stream_exhausted !== true;
        },
        loop: true,
        optional: true,
      })
      // When interaction is complete, send to transcriptExtractorNode for processing
      .addEdge(assemblyAISTTNode, transcriptExtractorNode, {
        condition: async (input: any) => {
          return input?.interaction_complete === true;
        },
      })
      .addEdge(transcriptExtractorNode, interactionQueueNode)
      .addEdge(interactionQueueNode, textInputNode, {
        condition: (input: TextInput) => {
          logger.debug({ text: input.text?.substring(0, 100) }, `InteractionQueueNode checking condition: "${input.text?.substring(0, 50)}..."`);
          return input.text && input.text.trim().length > 0;
        },
      })
      .addEdge(stateUpdateNode, interactionQueueNode, {
        loop: true,
        optional: true,
      })
      .setStartNode(audioInputNode);

    graphBuilder.setEndNode(ttsNode);

    const graph = graphBuilder.build();
    if (props.graphVisualizationEnabled) {
      const graphPath = path.join(os.tmpdir(), `${graphName}.png`);
      logger.info(
        { graphPath },
        'The Graph visualization will be saved to this path. If you see any fatal error after this message, pls disable graph visualization'
      );
    }

    // Return wrapper with assemblyAI node reference
    return new InworldGraphWrapper({
      graph,
      assemblyAINode: assemblyAISTTNode,
    });
  }
}
