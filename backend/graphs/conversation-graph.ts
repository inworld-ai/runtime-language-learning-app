import { 
  ComponentFactory, 
  CustomInputDataType, 
  CustomOutputDataType, 
  GraphBuilder, 
  NodeFactory, 
  registerCustomNodeType
} from '@inworld/runtime/graph';

export interface ConversationGraphConfig {
  apiKey: string;
}

export function createConversationGraph(config: ConversationGraphConfig) {
  // Create STT component
  const sttComponent = ComponentFactory.createRemoteSTTComponent({
    id: `stt_component`,
    sttConfig: {
      apiKey: config.apiKey,
      defaultConfig: {},
    },
  });

  const promptBuilderType = registerCustomNodeType(
    `prompt_builder_${Date.now()}`,
    [CustomInputDataType.TEXT],
    CustomOutputDataType.CHAT_REQUEST,
    async (context, input) => {
      console.log('prompt_builder', input);
      return {
        messages: [
          {
            role: 'user',
            content: `respond to the following user message: ${input}`
          }
        ]
      }
    }
  )

  const promptBuilderNode = NodeFactory.createCustomNode(
    'prompt_builder_node',
    promptBuilderType,
  );

  const proxyNode = NodeFactory.createProxyNode({
    id: 'proxy_node',
    reportToClient: true,
  });

  const llmNode = NodeFactory.createRemoteLLMChatNode({
    id: 'llm_node',
    llmConfig: {
      provider: 'openai',
      modelName: 'gpt-4.1-nano',
      apiKey: config.apiKey,
      stream: true,
      reportToClient: true,
    },
  });

  const sttNode = NodeFactory.createRemoteSTTNode({
    id: `stt_node`,
    sttComponentId: sttComponent.id,
  });

  const ttsComponent = ComponentFactory.createRemoteTTSComponent({
    id: `tts_component`,
    apiKey: config.apiKey,
    synthesisConfig: {
      type: 'inworld',
      config: {
        modelId: 'inworld-tts-1',
        postprocessing: {
          sampleRate: 16000
          },
          inference: {
            pitch: 1,
            speakingRate: 1,
            temperature: 0.7,
          },
        },
      }
  });

  const ttsNode = NodeFactory.createRemoteTTSNode({
    id: `tts_node`,
    ttsComponentId: ttsComponent.id,
    voice: {
      speakerId: 'Diego',
    }
  });

  const chunkerNode = NodeFactory.createTextChunkingNode({
    id: `chunker_node`
  });

  // Build graph
  const executor = new GraphBuilder(`conversation_graph`)
    .addComponent(sttComponent)
    .addComponent(ttsComponent)
    .addNode(sttNode) 
    .addNode(proxyNode)
    .addNode(promptBuilderNode)
    .addNode(llmNode)
    .addNode(ttsNode)
    .addNode(chunkerNode)
    .setStartNode(sttNode)
    .addEdge(sttNode, proxyNode)
    .addEdge(proxyNode, promptBuilderNode)
    .addEdge(promptBuilderNode, llmNode)
    .addEdge(llmNode, chunkerNode)
    .addEdge(chunkerNode, ttsNode)
    .setEndNode(ttsNode)
    .getExecutor()

  return executor;
}