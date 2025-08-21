import { 
  GraphBuilder, 
  CustomNode, 
  ProcessContext, 
  ProxyNode, 
  RemoteLLMChatNode, 
  RemoteSTTNode, 
  RemoteTTSNode, 
  TextChunkingNode,
  MCPClientComponent,
  MCPCallToolNode,
  MCPListToolsNode,
  GraphTypes
} from '@inworld/runtime/graph';
import { LLMMessageInterface } from '@inworld/runtime';
import { renderJinja } from '@inworld/runtime/primitives/llm';
import { conversationTemplate } from '../helpers/prompt-templates.ts';
import type { IntroductionState } from '../helpers/introduction-state-processor.ts';
import { execSync } from 'child_process';

export interface ConversationGraphConfig {
  apiKey: string;
}

function findNpxPath(): string {
  try {
    const isWin = process.platform === 'win32';
    const command = isWin ? 'where npx.cmd' : 'which npx';
    const npxPath = execSync(command, { encoding: 'utf8' }).trim();
    const firstPath = npxPath.split('\n')[0];
    return isWin ? `cmd.exe /c ${firstPath}` : firstPath;
  } catch (error) {
    console.error('❌ npx not found in PATH. Please install Node.js and npm to get npx:', error);
    throw error;
  }
}

export function createConversationGraph(
  _config: ConversationGraphConfig,
  getConversationState: () => { messages: Array<{ role: string; content: string; timestamp: string }> },
  getIntroductionState: () => IntroductionState
) {
  // Initialize MCP component if Brave API key is available
  let mcpComponent: MCPClientComponent | null = null;
  let mcpCallToolNode: MCPCallToolNode | null = null;
  let mcpListToolsNode: MCPListToolsNode | null = null;
  const isMCPEnabled = !!process.env.BRAVE_API_KEY;
  
  if (isMCPEnabled) {
    try {
      const npxPath = findNpxPath();
      mcpComponent = new MCPClientComponent({
        id: 'brave_mcp_component',
        sessionConfig: {
          transport: 'stdio',
          endpoint: `${npxPath} -y @modelcontextprotocol/server-brave-search`,
          authConfig: {
            type: 'stdio',
            config: {
              env: {
                BRAVE_API_KEY: process.env.BRAVE_API_KEY,
              },
            },
          },
        },
      });

      mcpListToolsNode = new MCPListToolsNode({
        id: 'mcp_list_tools_node',
        mcpComponent,
        reportToClient: false,
      });

      mcpCallToolNode = new MCPCallToolNode({
        id: 'mcp_call_tool_node',
        mcpComponent,
        reportToClient: true,
      });
      
      console.log('✅ MCP Brave search component initialized in conversation graph');
    } catch (error) {
      console.error('❌ Failed to initialize MCP component:', error);
    }
  } else {
    console.log('ℹ️ MCP disabled - no BRAVE_API_KEY found');
  }

  // Store context between nodes
  let lastUserInput: string = '';
  let availableTools: any[] = [];
  let firstLLMContent: GraphTypes.Content | null = null;

  // Custom node to combine user input with available tools
  class ToolsToLLMRequestNode extends CustomNode {
    async process(
      _context: ProcessContext, 
      userInput: string,
      listToolsResponse?: GraphTypes.ListToolsResponse
    ): Promise<GraphTypes.LLMChatRequest> {
      console.log('📝 ToolsToLLMRequestNode - Processing user input:', userInput);
      
      // Store the user input
      lastUserInput = userInput;
      
      // Store available tools if provided
      if (listToolsResponse && listToolsResponse.tools) {
        availableTools = listToolsResponse.tools;
        console.log('🔧 Available tools:', availableTools.map(t => t.name).join(', '));
      }

      const conversationState = getConversationState();
      const introductionState = getIntroductionState();

      // Build the prompt with conversation context
      const templateData = {
        messages: conversationState.messages || [],
        current_input: userInput,
        introduction_state: introductionState || { name: '', level: '', goal: '' },
        tools: availableTools
      };

      const renderedPrompt = await renderJinja(
        conversationTemplate,
        JSON.stringify(templateData),
      );

      const messages: LLMMessageInterface[] = [
        { role: 'user', content: renderedPrompt }
      ];

      console.log('💬 Sending to LLM with', availableTools.length, 'available tools');
      
      return new GraphTypes.LLMChatRequest({
        messages,
        tools: availableTools
      });
    }
  }

  // Custom node to convert LLM Content to ToolCallRequest for MCP
  class LLMResponseToToolCallsNode extends CustomNode {
    process(
      _context: ProcessContext,
      content: GraphTypes.Content
    ): GraphTypes.ToolCallRequest {
      console.log('🔄 LLMResponseToToolCallsNode - Converting Content to ToolCallRequest');
      
      // Store the content for later use in final LLM request
      firstLLMContent = content;
      
      if (content.toolCalls && content.toolCalls.length > 0) {
        console.log('  🔧 Tool calls found:', content.toolCalls.map(tc => tc.name).join(', '));
        return new GraphTypes.ToolCallRequest(content.toolCalls);
      }
      
      console.log('  💭 No tool calls in response (should not reach here with conditional edge)');
      return new GraphTypes.ToolCallRequest([]);
    }
  }

  // Custom node to transform tool call results into LLM request
  class ToolCallToLLMRequestNode extends CustomNode {
    async process(
      _context: ProcessContext,
      toolResults: GraphTypes.ToolCallResponse
    ): Promise<GraphTypes.LLMChatRequest> {
      console.log('📊 ToolCallToLLMRequestNode - Building request with tool results');
      
      const conversationState = getConversationState();
      const introductionState = getIntroductionState();

      // Build the prompt with conversation context, same as first LLM call
      const templateData = {
        messages: conversationState.messages || [],
        current_input: lastUserInput,
        introduction_state: introductionState || { name: '', level: '', goal: '' },
      };

      const renderedPrompt = await renderJinja(
        conversationTemplate,
        JSON.stringify(templateData),
      );

      const messages: LLMMessageInterface[] = [
        { role: 'user', content: renderedPrompt }
      ];

      // Add the assistant's tool call message if we have it
      if (firstLLMContent) {
        messages.push({
          role: 'assistant',
          content: firstLLMContent.content || '',
          toolCalls: firstLLMContent.toolCalls
        });
      }

      // Add tool results
      for (const result of toolResults.toolCallResults) {
        console.log('➕ Adding tool result for:', result.toolCallId);
        messages.push({
          role: 'tool',
          content: result.result,
          toolCallId: result.toolCallId
        });
      }

      console.log('💬 Sending final request to LLM with tool results');
      return new GraphTypes.LLMChatRequest({ messages });
    }
  }

  // Create nodes
  const sttNode = new RemoteSTTNode({
    id: 'stt_node',
    sttConfig: {},
  });
  
  const proxyNode = new ProxyNode({ 
    id: 'proxy_node', 
    reportToClient: true 
  });

  // Nodes for MCP flow
  const toolsToLLMRequestNode = new ToolsToLLMRequestNode({ 
    id: 'tools_to_llm_request_node' 
  });

  const llmResponseToToolCallsNode = new LLMResponseToToolCallsNode({
    id: 'llm_response_to_tool_calls_node'
  });

  const toolCallToLLMRequestNode = new ToolCallToLLMRequestNode({
    id: 'tool_call_to_llm_request_node'
  });

  // First LLM node (may generate tool calls)
  const firstLLMNode = new RemoteLLMChatNode({
    id: 'first_llm_node',
    provider: 'openai',
    modelName: 'gpt-4o-mini',
    stream: false,  // Non-streaming to properly detect tool calls
    reportToClient: true,
    textGenerationConfig: {
      maxNewTokens: 250,
      maxPromptLength: 2000,
      repetitionPenalty: 1,
      topP: 1,
      temperature: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
    }
  });

  // Final LLM node (generates response after tools)
  const finalLLMNode = new RemoteLLMChatNode({
    id: 'final_llm_node',
    provider: 'openai',
    modelName: 'gpt-4o-mini',
    stream: true,  // Stream the final response for better UX
    reportToClient: true,
    textGenerationConfig: {
      maxNewTokens: 250,
      maxPromptLength: 2000,
      repetitionPenalty: 1,
      topP: 1,
      temperature: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
    }
  });
  
  const chunkerNode = new TextChunkingNode({ 
    id: 'chunker_node' 
  });

  const chunkerFinalNode = new TextChunkingNode({ 
    id: 'chunker_final_node' 
  });
  
  const ttsNode = new RemoteTTSNode({
    id: 'tts_node',
    speakerId: 'Diego',
    modelId: 'inworld-tts-1',
    sampleRate: 16000,
    speakingRate: 1,
    temperature: 0.7,
  });

  const ttsFinalNode = new RemoteTTSNode({
    id: 'tts_final_node',
    speakerId: 'Diego',
    modelId: 'inworld-tts-1',
    sampleRate: 16000,
    speakingRate: 1,
    temperature: 0.7,
  });

  // Non-MCP flow nodes (simpler path when MCP is not available)
  class SimplePromptBuilderNode extends CustomNode {
    async process(_context: ProcessContext, userInput: string) {
      console.log('📝 SimplePromptBuilderNode - Processing without MCP');
      
      const conversationState = getConversationState();
      const introductionState = getIntroductionState();

      const templateData = {
        messages: conversationState.messages || [],
        current_input: userInput,
        introduction_state: introductionState || { name: '', level: '', goal: '' }
      };

      const renderedPrompt = await renderJinja(
        conversationTemplate,
        JSON.stringify(templateData),
      );

      return new GraphTypes.LLMChatRequest({
        messages: [{ role: 'user', content: renderedPrompt }]
      });
    }
  }

  // Build the graph
  const graphBuilder = new GraphBuilder({
    id: 'conversation_graph',
    enableRemoteConfig: false
  });

  // Add MCP flow if available
  if (mcpListToolsNode && mcpCallToolNode) {
    console.log('🚀 Building graph WITH MCP support');
    
    graphBuilder
      // Add all nodes
      .addNode(sttNode)
      .addNode(proxyNode)
      .addNode(mcpListToolsNode)
      .addNode(toolsToLLMRequestNode)
      .addNode(firstLLMNode)
      .addNode(llmResponseToToolCallsNode)
      .addNode(mcpCallToolNode)
      .addNode(toolCallToLLMRequestNode)
      .addNode(finalLLMNode)
      .addNode(chunkerNode)
      .addNode(chunkerFinalNode)
      .addNode(ttsNode)
      .addNode(ttsFinalNode)
      
      // Wire up the main flow
      .addEdge(sttNode, proxyNode)
      .addEdge(proxyNode, toolsToLLMRequestNode)
      .addEdge(mcpListToolsNode, toolsToLLMRequestNode)
      .addEdge(toolsToLLMRequestNode, firstLLMNode)
      
      // Conditional routing from firstLLMNode based on whether it has tool calls
      // Path 1: If LLM returns tool calls, convert and execute them
      .addEdge(firstLLMNode, llmResponseToToolCallsNode, {
        condition: (content: GraphTypes.Content) => {
          const hasToolCalls = !!(content && content.toolCalls && content.toolCalls.length > 0);
          console.log(`🔀 Conditional edge (firstLLM → toolConverter): hasToolCalls=${hasToolCalls}`);
          if (hasToolCalls) {
            console.log(`   Tool calls: ${content.toolCalls.map(tc => tc.name).join(', ')}`);
          }
          return hasToolCalls;
        },
      })
      
      // Path 2: If LLM returns just content (no tools), go straight to chunker/TTS
      .addEdge(firstLLMNode, chunkerNode, {
        condition: (content: GraphTypes.Content) => {
          const hasNoToolCalls = !content || !content.toolCalls || content.toolCalls.length === 0;
          const hasContent = !!(content && content.content);
          const shouldChunk = hasNoToolCalls && hasContent;
          console.log(`🔀 Conditional edge (firstLLM → chunker): hasNoToolCalls=${hasNoToolCalls}, hasContent=${hasContent}, shouldChunk=${shouldChunk}`);
          return shouldChunk;
        },
      })
      
      // Tool execution path
      .addEdge(llmResponseToToolCallsNode, mcpCallToolNode)
      .addEdge(mcpCallToolNode, toolCallToLLMRequestNode)
      .addEdge(toolCallToLLMRequestNode, finalLLMNode)
      .addEdge(finalLLMNode, chunkerFinalNode)
      .addEdge(chunkerFinalNode, ttsFinalNode)
      
      // Direct path (no tools)
      .addEdge(chunkerNode, ttsNode)
      
      // Set start nodes (STT and list tools)
      .setStartNodes([sttNode, mcpListToolsNode])
      // Set multiple end nodes
      .setEndNodes([ttsNode, ttsFinalNode]);
  } else {
    // Simpler flow without MCP
    console.log('🚀 Building graph WITHOUT MCP support');
    
    const simplePromptBuilderNode = new SimplePromptBuilderNode({
      id: 'simple_prompt_builder_node'
    });

    const simpleLLMNode = new RemoteLLMChatNode({
      id: 'simple_llm_node',
      provider: 'openai',
      modelName: 'gpt-4o-mini',
      stream: true,
      reportToClient: true,
      textGenerationConfig: {
        maxNewTokens: 250,
        maxPromptLength: 2000,
        repetitionPenalty: 1,
        topP: 1,
        temperature: 1,
        frequencyPenalty: 0,
        presencePenalty: 0,
      }
    });

    graphBuilder
      .addNode(sttNode)
      .addNode(proxyNode)
      .addNode(simplePromptBuilderNode)
      .addNode(simpleLLMNode)
      .addNode(chunkerNode)
      .addNode(ttsNode)
      .setStartNode(sttNode)
      .addEdge(sttNode, proxyNode)
      .addEdge(proxyNode, simplePromptBuilderNode)
      .addEdge(simplePromptBuilderNode, simpleLLMNode)
      .addEdge(simpleLLMNode, chunkerNode)
      .addEdge(chunkerNode, ttsNode)
      .setEndNode(ttsNode);
  }

  return graphBuilder.build();
}