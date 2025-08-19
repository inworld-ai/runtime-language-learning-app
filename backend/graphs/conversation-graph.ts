import { GraphBuilder, CustomNode, ProcessContext, ProxyNode, RemoteLLMChatNode, RemoteSTTNode, RemoteTTSNode, TextChunkingNode } from '@inworld/runtime/graph';
import { GraphTypes } from '@inworld/runtime/common';
import { renderJinja } from '@inworld/runtime/primitives/llm';
import { conversationTemplate } from '../helpers/prompt-templates.ts';
import type { IntroductionState } from '../helpers/introduction-state-processor.ts';

export interface ConversationGraphConfig {
  apiKey: string;
}

export function createConversationGraph(
  _config: ConversationGraphConfig,
  getConversationState: () => { messages: Array<{ role: string; content: string; timestamp: string }> },
  getIntroductionState: () => IntroductionState
) {
  // Create the custom node class with closure over getConversationState
  class EnhancedPromptBuilderNode extends CustomNode {
    async process(_context: ProcessContext, currentInput: string) {
      // Access getConversationState from the closure
      const conversationState = getConversationState();
      const introductionState = getIntroductionState();
      const templateData = {
        messages: conversationState.messages || [],
        current_input: currentInput,
        introduction_state: introductionState || { name: '', level: '', goal: '' }
      };

      // console.log(
      //   'Template data being sent to Jinja:',
      //   JSON.stringify(templateData, null, 2),
      // );

      const renderedPrompt = await renderJinja(
        conversationTemplate,
        JSON.stringify(templateData),
      );
      // console.log('=== Rendered Prompt ===');
      // console.log(renderedPrompt);
      // console.log('========================');
      
      // Return LLMChatRequest for the LLM node
      return new GraphTypes.LLMChatRequest({
        messages: [{ role: 'user', content: renderedPrompt }]
      });
    }
  }

  const sttNode = new RemoteSTTNode({
    id: 'stt_node',
    sttConfig: {},
  });
  const proxyNode = new ProxyNode({ id: 'proxy_node', reportToClient: true });
  const promptBuilderNode = new EnhancedPromptBuilderNode({ id: 'enhanced_prompt_builder_node' });
  const llmNode = new RemoteLLMChatNode({
    id: 'llm_node',
    provider: 'openai',
    modelName: 'gpt-4.1-nano',
    stream: true,
    reportToClient: true,
    textGenerationConfig: {
      maxNewTokens: 2500,
      maxPromptLength: 2000,
      repetitionPenalty: 1,
      topP: 1,
      temperature: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
    }
  });
  const chunkerNode = new TextChunkingNode({ id: 'chunker_node' });
  const ttsNode = new RemoteTTSNode({
    id: 'tts_node',
    speakerId: 'Diego',
    modelId: 'inworld-tts-1',
    sampleRate: 16000,
    speakingRate: 1,
    temperature: 0.7,
  });

  const executor = new GraphBuilder({
    id: 'conversation_graph',
    enableRemoteConfig: false
  })
    .addNode(sttNode)
    .addNode(proxyNode)
    .addNode(promptBuilderNode)
    .addNode(llmNode)
    .addNode(chunkerNode)
    .addNode(ttsNode)
    .setStartNode(sttNode)
    .addEdge(sttNode, proxyNode)
    .addEdge(proxyNode, promptBuilderNode)
    .addEdge(promptBuilderNode, llmNode)
    .addEdge(llmNode, chunkerNode)
    .addEdge(chunkerNode, ttsNode)
    .setEndNode(ttsNode)
    .build();

  return executor;
}