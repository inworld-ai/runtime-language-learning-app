import { 
  GraphBuilder, 
  CustomNode, 
  ProcessContext, 
  ProxyNode, 
  RemoteLLMChatNode, 
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

// Test version without STT/TTS for easier testing
export function createTestConversationGraph(
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
      
      console.log('✅ MCP Brave search component initialized in test graph');
    } catch (error) {
      console.error('❌ Failed to initialize MCP component:', error);
    }
  } else {
    console.log('ℹ️ MCP disabled - no BRAVE_API_KEY found');
  }

  // Store context between nodes
  let lastUserInput: string = '';
  let availableTools: any[] = [];

  // System prompt for Spanish learning with tools
  const SYSTEM_PROMPT_WITH_TOOLS = `You are a Spanish language learning assistant with access to web search tools.
When a user asks a question that would benefit from current information (news, events, facts, etc.), use the brave_web_search tool.
Always respond conversationally and incorporate Spanish naturally based on the user's level.`;

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
        introduction_state: introductionState || { name: '', level: '', goal: '' }
      };

      const renderedPrompt = await renderJinja(
        conversationTemplate,
        JSON.stringify(templateData),
      );

      const messages: LLMMessageInterface[] = [
        { role: 'system', content: SYSTEM_PROMPT_WITH_TOOLS },
        { role: 'user', content: renderedPrompt }
      ];

      console.log('💬 Sending to LLM with', availableTools.length, 'available tools');
      
      return new GraphTypes.LLMChatRequest({
        messages,
        tools: availableTools
      });
    }
  }

  // Custom node to convert LLM response to tool calls
  class LLMResponseToToolCallsNode extends CustomNode {
    process(
      _context: ProcessContext,
      content: GraphTypes.Content
    ): GraphTypes.ToolCallRequest {
      console.log('🔍 LLMResponseToToolCallsNode - Processing LLM response');
      
      if (content.toolCalls && content.toolCalls.length > 0) {
        console.log('🔧 Tool calls found:', content.toolCalls.map(tc => tc.name).join(', '));
      } else {
        console.log('💭 No tool calls in response');
      }
      
      return new GraphTypes.ToolCallRequest(content.toolCalls || []);
    }
  }

  // Custom node to build final response after tool execution
  class ToolResultsToLLMRequestNode extends CustomNode {
    process(
      _context: ProcessContext,
      llmContent: GraphTypes.Content,
      storedQuery: string,
      toolResults: GraphTypes.ToolCallResponse
    ): GraphTypes.LLMChatRequest {
      console.log('📊 ToolResultsToLLMRequestNode - Building final request with tool results');
      
      const conversationState = getConversationState();
      const introductionState = getIntroductionState();

      // Build messages including tool results
      const messages: LLMMessageInterface[] = [
        { 
          role: 'system', 
          content: `You are a Spanish language learning assistant. The user's level is ${introductionState.level}.
Provide a helpful, conversational response based on the search results. Incorporate Spanish naturally as appropriate for their level.` 
        },
        { role: 'user', content: storedQuery },
        {
          role: 'assistant',
          content: llmContent.content || '',
          toolCalls: llmContent.toolCalls
        }
      ];

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
  const inputNode = new ProxyNode({ 
    id: 'input_node', 
    reportToClient: true 
  });

  // Nodes for MCP flow
  const toolsToLLMRequestNode = new ToolsToLLMRequestNode({ 
    id: 'tools_to_llm_request_node' 
  });
  
  const llmResponseToToolCallsNode = new LLMResponseToToolCallsNode({
    id: 'llm_response_to_tool_calls_node'
  });

  const toolResultsToLLMRequestNode = new ToolResultsToLLMRequestNode({
    id: 'tool_results_to_llm_request_node'
  });

  // First LLM node (may generate tool calls)
  const firstLLMNode = new RemoteLLMChatNode({
    id: 'first_llm_node',
    provider: 'openai',
    modelName: 'gpt-4o-mini',
    stream: false,
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
    stream: false,
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

  // Build the graph
  const graphBuilder = new GraphBuilder({
    id: 'test_conversation_graph',
    enableRemoteConfig: false
  });

  // Add MCP flow if available
  if (mcpListToolsNode && mcpCallToolNode) {
    console.log('🚀 Building test graph WITH MCP support');
    
    graphBuilder
      // Add all nodes
      .addNode(inputNode)
      .addNode(mcpListToolsNode)
      .addNode(toolsToLLMRequestNode)
      .addNode(firstLLMNode)
      .addNode(llmResponseToToolCallsNode)
      .addNode(mcpCallToolNode)
      .addNode(toolResultsToLLMRequestNode)
      .addNode(finalLLMNode)
      
      // Wire up the flow (following the example pattern)
      .addEdge(inputNode, toolsToLLMRequestNode)
      .addEdge(mcpListToolsNode, toolsToLLMRequestNode)
      .addEdge(toolsToLLMRequestNode, firstLLMNode)
      .addEdge(firstLLMNode, llmResponseToToolCallsNode)
      .addEdge(llmResponseToToolCallsNode, mcpCallToolNode)
      .addEdge(firstLLMNode, toolResultsToLLMRequestNode)
      .addEdge(inputNode, toolResultsToLLMRequestNode)
      .addEdge(mcpCallToolNode, toolResultsToLLMRequestNode)
      .addEdge(toolResultsToLLMRequestNode, finalLLMNode)
      
      // Set start nodes (input and list tools)
      .setStartNodes([inputNode, mcpListToolsNode])
      .setEndNode(finalLLMNode);
  } else {
    // Simpler flow without MCP
    console.log('🚀 Building test graph WITHOUT MCP support');
    
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

    const simplePromptBuilderNode = new SimplePromptBuilderNode({
      id: 'simple_prompt_builder_node'
    });

    const simpleLLMNode = new RemoteLLMChatNode({
      id: 'simple_llm_node',
      provider: 'openai',
      modelName: 'gpt-4o-mini',
      stream: false,
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
      .addNode(inputNode)
      .addNode(simplePromptBuilderNode)
      .addNode(simpleLLMNode)
      .setStartNode(inputNode)
      .addEdge(inputNode, simplePromptBuilderNode)
      .addEdge(simplePromptBuilderNode, simpleLLMNode)
      .setEndNode(simpleLLMNode);
  }

  return graphBuilder.build();
}