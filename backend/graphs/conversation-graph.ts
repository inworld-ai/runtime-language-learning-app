import { 
  ComponentFactory, 
  CustomInputDataType, 
  CustomOutputDataType, 
  GraphBuilder, 
  NodeFactory, 
  registerCustomNodeType
} from '@inworld/runtime/graph';
import { renderJinja } from '@inworld/runtime/primitives/llm';
import { conversationTemplate } from '../helpers/prompt-templates.ts';

export interface ConversationGraphConfig {
  apiKey: string;
}

export function createConversationGraph(
  config: ConversationGraphConfig,
  getConversationState: () => { messages: Array<{ role: string; content: string; timestamp: string }> }
) {
  // Create STT component
  const sttComponent = ComponentFactory.createRemoteSTTComponent({
    id: `stt_component`,
    sttConfig: {
      apiKey: config.apiKey,
      defaultConfig: {},
    },
  });

  const enhancedPromptBuilderType = registerCustomNodeType(
    `enhanced_prompt_builder_${Date.now()}`,
    [CustomInputDataType.TEXT], // Current STT transcription
    CustomOutputDataType.CHAT_REQUEST,
    async (context, currentInput) => {
      const conversationState = getConversationState(); // Previous conversation

      const template = conversationTemplate;

      const templateData = {
        messages: conversationState.messages || [],
        current_input: currentInput
      };

      console.log('Template data being sent to Jinja:', JSON.stringify(templateData, null, 2));

      const renderedPrompt = await renderJinja(template, JSON.stringify(templateData));
      console.log('=== Rendered Prompt ===');
      console.log(renderedPrompt);
      console.log('========================');

      return {
        messages: [{ role: 'user', content: renderedPrompt }]
      };
    }
  )

  const promptBuilderNode = NodeFactory.createCustomNode(
    'enhanced_prompt_builder_node',
    enhancedPromptBuilderType,
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
    .getExecutor({
      disableRemoteConfig: true,
    })

  return executor;
}