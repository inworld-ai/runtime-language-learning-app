import {
  CustomNode,
  Graph,
  GraphBuilder,
  GraphTypes,
  ProcessContext,
  ProxyNode,
  RemoteLLMChatNode,
  RemoteSTTNode,
  RemoteTTSNode,
  TextChunkingNode,
} from '@inworld/runtime/graph';
import * as os from 'os';
import * as path from 'path';

import { TEXT_CONFIG, TTS_SAMPLE_RATE } from '../../constants';
import {
  AudioInput,
  CreateGraphPropsInterface,
  State,
  TextInput,
} from '../types';
import { EventFactory } from './event_factory';

export class InworldGraphWrapper {
  graph: Graph;

  private constructor({ graph }: { graph: Graph }) {
    this.graph = graph;
  }

  destroy() {
    this.graph.stopExecutor();
    this.graph.cleanupAllExecutions();
    this.graph.destroy();
  }

  static async create(props: CreateGraphPropsInterface) {
    const {
      apiKey,
      llmModelName,
      llmProvider,
      voiceId,
      connections,
      withAudioInput = false,
      ttsModelId,
    } = props;

    const postfix = withAudioInput ? '-with-audio-input' : '-with-text-input';

    // Custom node to build a LLM chat request from the state.
    class DialogPromptBuilderNode extends CustomNode {
      process(
        _context: ProcessContext,
        state: State,
      ): GraphTypes.LLMChatRequest {
        // Convert state messages to LLMMessageInterface format
        const conversationMessages = state.messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        }));

        return new GraphTypes.LLMChatRequest({
          messages: conversationMessages,
        });
      }
    }

    // Custom node to update the state with the user's input this turn.
    class UpdateStateNode extends CustomNode {
      process(_context: ProcessContext, input: TextInput): State {
        const { text, interactionId, key } = input;
        connections[key].state.messages.push({
          role: 'user',
          content: text,
          id: interactionId,
        });
        connections[key].ws.send(
          JSON.stringify(
            EventFactory.text(text, interactionId, {
              isUser: true,
            }),
          ),
        );
        return connections[key].state;
      }
    }

    const dialogPromptBuilderNode = new DialogPromptBuilderNode({
      id: `dialog-prompt-builder-node${postfix}`,
    });
    const updateStateNode = new UpdateStateNode();

    const llmNode = new RemoteLLMChatNode({
      id: `llm-node${postfix}`,
      provider: llmProvider,
      modelName: llmModelName,
      stream: true,
      textGenerationConfig: TEXT_CONFIG,
    });

    const textChunkingNode = new TextChunkingNode({
      id: `text-chunking-node${postfix}`,
    });

    const ttsNode = new RemoteTTSNode({
      id: `tts-node${postfix}`,
      speakerId: voiceId,
      modelId: ttsModelId,
      sampleRate: TTS_SAMPLE_RATE,
      temperature: 0.8,
      speakingRate: 1,
    });

    const graphName = `character-chat${postfix}`;
    const graphBuilder = new GraphBuilder({ id: graphName, apiKey });

    graphBuilder
      .addNode(updateStateNode)
      .addNode(dialogPromptBuilderNode)
      .addNode(llmNode)
      .addNode(textChunkingNode)
      .addNode(ttsNode)
      .addEdge(updateStateNode, dialogPromptBuilderNode)
      .addEdge(dialogPromptBuilderNode, llmNode)
      .addEdge(llmNode, textChunkingNode)
      .addEdge(textChunkingNode, ttsNode);

    if (withAudioInput) {
      // Custom node to join the result from STT and the original input metadata to form
      // the final text input.
      class TextInputNode extends CustomNode {
        process(
          _context: ProcessContext,
          audioInput: AudioInput,
          text: string,
        ): TextInput {
          const { audio: _audio, ...rest } = audioInput as any;
          return { text, ...(rest as object) } as TextInput;
        }
      }

      // Custom node to extract the audio data from the audio input to pass to the stt node
      class AudioFilterNode extends CustomNode {
        process(_context: ProcessContext, input: AudioInput): GraphTypes.Audio {
          return new GraphTypes.Audio({
            data: input.audio.data,
            sampleRate: input.audio.sampleRate,
          });
        }
      }

      // start node to pass the audio input to both the audio filter and text input nodes.
      const audioInputNode = new ProxyNode();

      const textInputNode = new TextInputNode();
      const audioFilterNode = new AudioFilterNode();
      const sttNode = new RemoteSTTNode();

      graphBuilder
        .addNode(audioInputNode)
        .addNode(audioFilterNode)
        .addNode(sttNode)
        .addNode(textInputNode)
        .addEdge(audioInputNode, textInputNode)
        .addEdge(audioInputNode, audioFilterNode)
        .addEdge(audioFilterNode, sttNode)
        .addEdge(sttNode, textInputNode)
        .addEdge(textInputNode, updateStateNode)
        .setStartNode(audioInputNode);
    } else {
      graphBuilder.setStartNode(updateStateNode);
    }

    graphBuilder.setEndNode(ttsNode);

    const graph = graphBuilder.build();
    if (props.graphVisualizationEnabled) {
      console.log(
        'The Graph visualization has started. If you see any fatal error after this message, pls disable graph visualization.',
      );
      const graphPath = path.join(os.tmpdir(), `${graphName}.png`);

      await graph.visualize(graphPath);
    }

    return new InworldGraphWrapper({
      graph,
    });
  }
}
