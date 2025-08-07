import { ComponentFactory, CustomInputDataType, CustomOutputDataType, GraphBuilder, NodeFactory, registerCustomNodeType } from '@inworld/runtime/graph';
import { TEXT_CONFIG } from '../../runtime_examples/cli/constants';

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
    id: 'llm-node',
    llmConfig: {
      provider: 'openai',
      modelName: 'gpt-4.1-nano',
      apiKey: config.apiKey,
      stream: true,
    },
  });

  // Create STT node
  const sttNode = NodeFactory.createRemoteSTTNode({
    id: `stt_node`,
    sttComponentId: sttComponent.id,
  });

  // Build graph
  const executor = new GraphBuilder(`conversation_graph`)
    .addComponent(sttComponent)
    .addNode(sttNode) 
    .addNode(proxyNode)
    .addNode(promptBuilderNode)
    .addNode(llmNode)
    .setStartNode(sttNode)
    .addEdge(sttNode, proxyNode)
    .addEdge(proxyNode, promptBuilderNode)
    .addEdge(promptBuilderNode, llmNode)
    .setEndNode(llmNode)
    .getExecutor();

  return executor;
}