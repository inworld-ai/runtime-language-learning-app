import {
  ComponentFactory,
  CustomInputDataType,
  CustomInputDataTypeTyped,
  CustomOutputDataType,
  CustomOutputDataTypeTyped,
  GraphBuilder,
  GraphExecutor,
  NodeFactory,
  registerCustomNodeType,
} from '@inworld/runtime/graph';
import * as os from 'os';
import * as path from 'path';

import { TTS_SAMPLE_RATE } from '../../constants';
import { preparePrompt } from '../helpers';
import {
  AudioInput,
  CreateGraphPropsInterface,
  State,
  TextInput,
} from '../types';
import { EventFactory } from './event_factory';

export class InworldGraph {
  executor: InstanceType<typeof GraphExecutor>;

  private constructor({
    executor,
  }: {
    executor: InstanceType<typeof GraphExecutor>;
  }) {
    this.executor = executor;
  }

  destroy() {
    this.executor.stopExecutor();
    this.executor.cleanupAllExecutions();
    this.executor.destroy();
  }

  static async create(props: CreateGraphPropsInterface) {
    const {
      apiKey,
      llmModelName,
      llmProvider,
      voiceId,
      dialogPromptTemplate,
      connections,
      withAudioInput = false,
      ttsModelId,
    } = props;

    const postfix = withAudioInput ? '-with-audio-input' : '-with-text-input';

    // Register custom node types with captured variables in closures
    const dialogPromptBuilderNodeType = registerCustomNodeType(
      `dialog-prompt-builder-node${postfix}`,
      [CustomInputDataTypeTyped<State>()],
      CustomOutputDataType.TEXT,
      async (_context, state) => {
        const prompt = await preparePrompt(dialogPromptTemplate, {
          agent: state.agent,
          messages: state.messages.slice(0, state.messages.length - 1),
          userName: state.userName,
          userQuery: state.messages[state.messages.length - 1].content,
        });
        return prompt;
      },
    );

    const updateStateNodeType = registerCustomNodeType(
      `update-state-node${postfix}`,
      [
        CustomInputDataTypeTyped<{
          text: string;
          interactionId: string;
          key: string;
        }>(),
      ],
      CustomOutputDataTypeTyped<State>(),
      (_context, input) => {
        let { text, interactionId, key } = input;
        connections[key].state.messages.push({
          role: 'user',
          content: text,
          id: interactionId,
        });

        // Send the user's text input to the client.
        connections[key].ws.send(
          JSON.stringify(
            EventFactory.text(text, interactionId, {
              isUser: true,
            }),
          ),
        );
        return connections[key].state;
      },
    );

    // Create custom nodes using DSL
    const dialogPromptBuilderNode = NodeFactory.createCustomNode(
      `dialog-prompt-builder-node${postfix}`,
      dialogPromptBuilderNodeType,
    );

    const updateStateNode = NodeFactory.createCustomNode(
      `update-state-node${postfix}`,
      updateStateNodeType,
    );

    // Use new DSL LLM node creation
    const llmNode = NodeFactory.createRemoteLLMCompletionNode({
      id: `llm-node${postfix}`,
      llmConfig: {
        modelName: llmModelName,
        provider: llmProvider,
        apiKey,
        stream: true,
      },
    });

    const textChunkingNode = NodeFactory.createTextChunkingNode({
      id: `text-chunking-node${postfix}`,
    });

    const ttsComponent = ComponentFactory.createRemoteTTSComponent({
      id: `tts-component${postfix}`,
      apiKey,
      synthesisConfig: {
        type: 'inworld',
        config: {
          modelId: ttsModelId,
          inference: {
            temperature: 0.8,
            pitch: 0,
            speakingRate: 1.0,
          },
          postprocessing: {
            sampleRate: TTS_SAMPLE_RATE,
          },
        },
      },
    });

    const ttsNode = NodeFactory.createRemoteTTSNode({
      id: `tts-node${postfix}`,
      ttsComponentId: ttsComponent.id,
      voice: {
        speakerId: voiceId,
      },
    });

    const graphName = `character-chat${postfix}`;
    const graph = new GraphBuilder(graphName);

    graph
      .addComponent(ttsComponent)
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
      const textInputNodeType = registerCustomNodeType(
        `text-input-node${postfix}`,
        [CustomInputDataTypeTyped<AudioInput>(), CustomInputDataType.TEXT],
        CustomOutputDataType.CUSTOM,
        (_context, audioInput, text) => {
          const { audio: _audio, ...rest } = audioInput;
          return {
            text,
            ...rest,
          } as TextInput;
        },
      );

      const audioInputNodeType = registerCustomNodeType(
        `audio-input-node${postfix}`,
        [CustomInputDataTypeTyped<AudioInput>()],
        CustomOutputDataTypeTyped<AudioInput>(),
        (context, input) => {
          return input;
        },
      );

      const audioFilterNodeType = registerCustomNodeType(
        `audio-filter-node${postfix}`,
        [CustomInputDataTypeTyped<AudioInput>()],
        CustomOutputDataType.TTS,
        (_context, input) => {
          const { audio } = input;
          return audio;
        },
      );

      const audioInputNode = NodeFactory.createCustomNode(
        `audio-input-node${postfix}`,
        audioInputNodeType,
      );

      const textInputNode = NodeFactory.createCustomNode(
        `text-input-node${postfix}`,
        textInputNodeType,
      );

      const audioFilterNode = NodeFactory.createCustomNode(
        `audio-filter-node${postfix}`,
        audioFilterNodeType,
      );

      const sttComponent = ComponentFactory.createRemoteSTTComponent({
        id: 'stt-component',
        sttConfig: {
          apiKey: apiKey,
          defaultConfig: {},
        },
      });

      const sttNode = NodeFactory.createRemoteSTTNode({
        id: 'stt-node',
        sttComponentId: sttComponent.id,
      });

      graph
        .addComponent(sttComponent)
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
      graph.setStartNode(updateStateNode);
    }

    graph.setEndNode(ttsNode);

    const executor = graph.getExecutor();
    if (props.graphVisualizationEnabled) {
      console.log(
        'The Graph visualization has started..If you see any fatal error after this message, pls disable graph visualization.',
      );
      const graphPath = path.join(os.tmpdir(), `${graphName}.png`);

      await executor.visualize(graphPath);
    }

    return new InworldGraph({
      executor,
    });
  }
}
