import { 
  GraphBuilder, 
  CustomNode, 
  ProcessContext, 
  ProxyNode, 
  RemoteLLMChatNode, 
  RemoteSTTNode, 
  RemoteTTSNode, 
  TextChunkingNode,
  MCPCallToolNode,
  MCPListToolsNode,
  GraphTypes
} from '@inworld/runtime/graph';
import { LLMMessageInterface } from '@inworld/runtime';
import { renderJinja } from '@inworld/runtime/primitives/llm';
import { conversationTemplate } from '../helpers/prompt-templates.ts';
import type { IntroductionState } from '../helpers/introduction-state-processor.ts';
import { MCPManager } from '../helpers/mcp.ts';

export interface ConversationGraphConfig {
  apiKey: string;
}

export function createConversationGraph(
  _config: ConversationGraphConfig,
  getConversationState: () => { messages: Array<{ role: string; content: string; timestamp: string }> },
  getIntroductionState: () => IntroductionState
) {
  // Initialize MCP nodes for all enabled servers via centralized MCPManager
  const enabledServerIds = MCPManager.getEnabledServerIds();
  const perServerListNodes: Record<string, MCPListToolsNode> = {};
  const perServerCallNodes: Record<string, MCPCallToolNode> = {};
  for (const serverId of enabledServerIds) {
    try {
      const nodes = MCPManager.createNodes(serverId, {
        listId: `${serverId}_mcp_list_tools_node`,
        callId: `${serverId}_mcp_call_tool_node`,
        reportListToClient: false,
        reportCallToClient: true,
      });
      if (nodes) {
        perServerListNodes[serverId] = nodes.list;
        perServerCallNodes[serverId] = nodes.call;
        console.log(`✅ MCP nodes initialized via MCPManager for server: ${serverId}`);
      }
    } catch (error) {
      console.error(`❌ Failed to initialize MCP nodes for server ${serverId}:`, error);
    }
  }
  console.log('🔧 Enabled MCP servers:', Object.keys(perServerListNodes).join(', '));

  // Store context between nodes
  let lastUserInput: string = '';
  let availableTools: any[] = [];
  let firstLLMContent: GraphTypes.Content | null = null;
  const serverIdToToolNames: Map<string, Set<string>> = new Map();
  // Global accumulators to avoid relying on `this` in custom node methods
  const aggregatedSeenTools: Set<string> = new Set();
  let aggregatedToolsArray: any[] = [];

  // Custom node to combine user input with available tools
  class ToolsToLLMRequestNode extends CustomNode {
    async process(
      _context: ProcessContext, 
      userInput: string,
      listToolsResponse?: GraphTypes.ListToolsResponse
    ): Promise<GraphTypes.LLMChatRequest> {
      console.log('📝 ToolsToLLMRequestNode - Processing user input:', userInput);
      console.log(`🧾 ToolsToLLMRequestNode - Aggregated tools available: ${aggregatedToolsArray.length}`);
      
      // Store the user input
      lastUserInput = userInput;
      
      // Store available tools if provided
      if (listToolsResponse && listToolsResponse.tools) {
        console.log(`🧾 ToolsToLLMRequestNode - Received tools list with ${listToolsResponse.tools.length} tools`);
      }

      const conversationState = getConversationState();
      const introductionState = getIntroductionState();

      // Build the prompt with conversation context
      const templateData = {
        messages: conversationState.messages || [],
        current_input: userInput,
        introduction_state: introductionState || { name: '', level: '', goal: '' },
        tools: (aggregatedToolsArray.length > 0 ? aggregatedToolsArray : (listToolsResponse?.tools || availableTools))
      };

      const renderedPrompt = await renderJinja(
        conversationTemplate,
        JSON.stringify(templateData),
      );

      const messages: LLMMessageInterface[] = [
        { role: 'user', content: renderedPrompt }
      ];

      const toolsForLog = templateData.tools || [];
      console.log('💬 Sending to LLM with', (toolsForLog as any[]).length, 'available tools');
      console.log('   Tools:', (toolsForLog as any[]).map((t: any) => t.name).join(', '));
      
      return new GraphTypes.LLMChatRequest({
        messages,
        tools: availableTools
      });
    }
  }

  // Aggregates tools from multiple ListTools responses
  class AggregateToolsNode extends CustomNode {
    process(_context: ProcessContext, listToolsResponse: GraphTypes.ListToolsResponse): GraphTypes.ListToolsResponse {
      if (listToolsResponse && listToolsResponse.tools) {
        for (const tool of listToolsResponse.tools) {
          if (!aggregatedSeenTools.has(tool.name)) {
            aggregatedSeenTools.add(tool.name);
            aggregatedToolsArray.push(tool);
          }
        }
        console.log('📥 AggregateToolsNode - Received tools:', listToolsResponse.tools.map(t => t.name).join(', '));
        console.log('📈 AggregateToolsNode - Total aggregated tools:', aggregatedToolsArray.length);
      }
      // Update global availableTools reference used for prompt building
      availableTools = aggregatedToolsArray;
      return new GraphTypes.ListToolsResponse({ tools: aggregatedToolsArray });
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

  // Detect which servers have calls in this turn
  class ServerCallsDetectorNode extends CustomNode {
    process(_context: ProcessContext, content: GraphTypes.Content): string[] {
      const serverIds: Set<string> = new Set();
      if (content && content.toolCalls) {
        for (const call of content.toolCalls) {
          for (const [sid, names] of serverIdToToolNames.entries()) {
            if (names.has(call.name)) {
              serverIds.add(sid);
            }
          }
        }
      }
      const result = Array.from(serverIds);
      console.log('🧭 Servers with tool calls:', result.join(', '));
      return result;
    }
  }

  // Factory: Filters tool calls for a specific server
  function createFilterToolCallsNode(serverId: string, id: string): CustomNode {
    return new (class extends CustomNode {
      process(_context: ProcessContext, request: GraphTypes.ToolCallRequest): GraphTypes.ToolCallRequest {
        const names = serverIdToToolNames.get(serverId) || new Set<string>();
        const incoming = (request.toolCalls || []).map(tc => tc.name);
        const filtered = (request.toolCalls || []).filter(tc => names.has(tc.name));
        console.log(`🧰 Filter server=${serverId} incoming=[${incoming.join(', ')}] matched=[${filtered.map(tc => tc.name).join(', ')}]`);
        return new GraphTypes.ToolCallRequest(filtered);
      }
    })({ id });
  }

  // Factory: Records tools for a specific server
  function createRecordToolsNode(serverId: string, id: string): CustomNode {
    return new (class extends CustomNode {
      process(_context: ProcessContext, listToolsResponse: GraphTypes.ListToolsResponse): GraphTypes.ListToolsResponse {
        const set = serverIdToToolNames.get(serverId) || new Set<string>();
        if (listToolsResponse && listToolsResponse.tools) {
          for (const tool of listToolsResponse.tools) {
            set.add(tool.name);
          }
          serverIdToToolNames.set(serverId, set);
          console.log(`🗂️ Recorded ${set.size} tools for server ${serverId}: ${Array.from(set).join(', ')}`);
        }
        return listToolsResponse;
      }
    })({ id });
  }

  // Accumulates ToolCallResponses from multiple servers until all expected are received
  class MergeToolResponsesNode extends CustomNode {
    private expected: Set<string> = new Set();
    private collected: Map<string, GraphTypes.ToolCallResponse> = new Map();

    process(_context: ProcessContext, input: any): GraphTypes.ToolCallResponse | null {
      // If input is an array of serverIds, set expected
      if (Array.isArray(input)) {
        this.expected = new Set(input);
        this.collected.clear();
        console.log('📦 MergeToolResponsesNode expecting servers:', Array.from(this.expected).join(', '));
        return null;
      }

      // If input looks like a ToolCallResponse, store it
      if (input && input.toolCallResults) {
        // We don't have serverId directly; infer by first toolCallId suffix if encoded, or count progression.
        // As a fallback, use an incremental key to avoid overwrite.
        const key = `srv_${this.collected.size}`;
        this.collected.set(key, input as GraphTypes.ToolCallResponse);
        console.log('📥 MergeToolResponsesNode received one ToolCallResponse');
      }

      // If we have all expected (or if expected is empty but we have at least one), merge and emit
      if ((this.expected.size > 0 && this.collected.size >= this.expected.size) || (this.expected.size === 0 && this.collected.size > 0)) {
        const merged: any[] = [];
        for (const resp of this.collected.values()) {
          if (resp && resp.toolCallResults) {
            for (const r of resp.toolCallResults) merged.push(r);
          }
        }
        console.log(`🧩 Merged ${merged.length} tool call results from ${this.collected.size} server(s)`);
        // Reset for next turn
        const output = new GraphTypes.ToolCallResponse(merged);
        this.expected.clear();
        this.collected.clear();
        return output;
      }

      return null;
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
  // Input router that conditionally forwards Audio to STT or string to proxy
  const inputRouterNode = new ProxyNode({ id: 'input_router_node', reportToClient: false });
  
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

  const serverCallsDetectorNode = new ServerCallsDetectorNode({ id: 'server_calls_detector_node' });
  const mergeToolResponsesNode = new MergeToolResponsesNode({ id: 'merge_tool_responses_node' });
  const toolCallToLLMRequestNode = new ToolCallToLLMRequestNode({ id: 'tool_call_to_llm_request_node' });

  const aggregateToolsNode = new AggregateToolsNode({ id: 'aggregate_tools_node' });

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

  const haveAnyMCP = Object.keys(perServerListNodes).length > 0 && Object.keys(perServerCallNodes).length > 0;

  // Add MCP flow if available
  if (haveAnyMCP) {
    console.log('🚀 Building graph WITH MCP support');
    
    graphBuilder
      // Add all nodes
      .addNode(sttNode)
      .addNode(inputRouterNode)
      .addNode(proxyNode)
      .addNode(aggregateToolsNode)
      .addNode(toolsToLLMRequestNode)
      .addNode(firstLLMNode)
      .addNode(llmResponseToToolCallsNode)
      .addNode(serverCallsDetectorNode)
      .addNode(mergeToolResponsesNode)
      .addNode(toolCallToLLMRequestNode)
      .addNode(finalLLMNode)
      .addNode(chunkerNode)
      .addNode(chunkerFinalNode)
      .addNode(ttsNode)
      .addNode(ttsFinalNode)
      // Start tools aggregation
      .addEdge(inputRouterNode, sttNode, {
        condition: (input: any) => input instanceof GraphTypes.Audio,
      })
      .addEdge(inputRouterNode, proxyNode, {
        condition: (input: any) => typeof input === 'string',
      })
      .addEdge(proxyNode, toolsToLLMRequestNode)
      .addEdge(aggregateToolsNode, toolsToLLMRequestNode)
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
      .addEdge(firstLLMNode, serverCallsDetectorNode, {
        condition: (content: GraphTypes.Content) => !!(content && content.toolCalls && content.toolCalls.length > 0),
      })
      .addEdge(serverCallsDetectorNode, mergeToolResponsesNode)
      
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
      
      // Tool execution path (per server, dynamic wiring below)
      .addEdge(mergeToolResponsesNode, toolCallToLLMRequestNode)
      .addEdge(toolCallToLLMRequestNode, finalLLMNode)
      .addEdge(finalLLMNode, chunkerFinalNode)
      .addEdge(chunkerFinalNode, ttsFinalNode)
      
      // Direct path (no tools)
      .addEdge(chunkerNode, ttsNode)
      
      // Set start nodes (STT and list tools)
      .setStartNodes([sttNode])
      // Set multiple end nodes
      .setEndNodes([ttsNode, ttsFinalNode]);

    // Add and wire per-server list and call nodes
    const startNodes: any[] = [inputRouterNode];
    for (const serverId of Object.keys(perServerListNodes)) {
      const listNode = perServerListNodes[serverId];
      const recordNode = createRecordToolsNode(serverId, `${serverId}_record_tools_node`);
      graphBuilder
        .addNode(listNode)
        .addNode(recordNode)
        .addEdge(listNode, recordNode)
        .addEdge(recordNode, aggregateToolsNode);
      startNodes.push(listNode);
    }
    graphBuilder.setStartNodes(startNodes);

    for (const serverId of Object.keys(perServerCallNodes)) {
      const filterNode = createFilterToolCallsNode(serverId, `${serverId}_filter_tool_calls_node`);
      const callNode = perServerCallNodes[serverId];
      graphBuilder
        .addNode(filterNode)
        .addNode(callNode)
        .addEdge(llmResponseToToolCallsNode, filterNode)
        .addEdge(filterNode, callNode, {
          condition: (request: GraphTypes.ToolCallRequest) => !!(request && request.toolCalls && request.toolCalls.length > 0),
        })
        .addEdge(callNode, mergeToolResponsesNode);
    }
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
      .addNode(inputRouterNode)
      .addNode(proxyNode)
      .addNode(simplePromptBuilderNode)
      .addNode(simpleLLMNode)
      .addNode(chunkerNode)
      .addNode(ttsNode)
      .setStartNode(inputRouterNode)
      .addEdge(inputRouterNode, sttNode, {
        condition: (input: any) => input instanceof GraphTypes.Audio,
      })
      .addEdge(inputRouterNode, proxyNode, {
        condition: (input: any) => typeof input === 'string',
      })
      .addEdge(proxyNode, simplePromptBuilderNode)
      .addEdge(simplePromptBuilderNode, simpleLLMNode)
      .addEdge(simpleLLMNode, chunkerNode)
      .addEdge(chunkerNode, ttsNode)
      .setEndNode(ttsNode);
  }

  return graphBuilder.build();
}