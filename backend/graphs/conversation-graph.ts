import { ComponentFactory, GraphBuilder, NodeFactory } from '@inworld/runtime/graph';

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

  // Create STT node
  const sttNode = NodeFactory.createRemoteSTTNode({
    id: `stt_node`,
    sttComponentId: sttComponent.id,
  });

  // Build STT graph
  const executor = new GraphBuilder(`conversation_graph`)
    .addComponent(sttComponent)
    .addNode(sttNode)
    .setStartNode(sttNode)
    .setEndNode(sttNode)
    .getExecutor();

  return executor;
}