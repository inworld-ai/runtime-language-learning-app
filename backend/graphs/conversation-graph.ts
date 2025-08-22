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
        reportCallToClient: false,
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
  // NEW: Keep full tool specs per server to recompute aggregate deterministically
  const serverIdToTools: Map<string, any[]> = new Map();
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

      // Recompute aggregated tools from per-server cache to avoid race conditions
      const combinedUnique: any[] = [];
      const seen = new Set<string>();
      for (const tools of serverIdToTools.values()) {
        for (const t of tools || []) {
          if (!seen.has(t.name)) {
            seen.add(t.name);
            combinedUnique.push(t);
          }
        }
      }
      // Fallbacks
      const toolsForPrompt = combinedUnique.length > 0
        ? combinedUnique
        : (aggregatedToolsArray.length > 0
            ? aggregatedToolsArray
            : (listToolsResponse?.tools || availableTools));

      console.log(`🧾 ToolsToLLMRequestNode - Tools available for prompt: ${toolsForPrompt.length}`);
      console.log('   Tools:', toolsForPrompt.map((t: any) => t.name).join(', '));
      
      // Store the user input
      lastUserInput = userInput;
      
      const conversationState = getConversationState();
      const introductionState = getIntroductionState();

      // Build the prompt with conversation context
      const templateData = {
        messages: conversationState.messages || [],
        current_input: userInput,
        introduction_state: introductionState || { name: '', level: '', goal: '' },
        tools: toolsForPrompt,
      };

      const renderedPrompt = await renderJinja(
        conversationTemplate,
        JSON.stringify(templateData),
      );

      const messages: LLMMessageInterface[] = [
        { role: 'user', content: renderedPrompt }
      ];

      console.log('💬 Sending to LLM with', toolsForPrompt.length, 'available tools');
      console.log('   Tools:', toolsForPrompt.map((t: any) => t.name).join(', '));
      
      return new GraphTypes.LLMChatRequest({
        messages,
        tools: toolsForPrompt,
      });
    }
  }

  // Aggregates tools from multiple ListTools responses
  // Using closure to maintain state since instance properties don't persist
  const aggregateState = {
    receivedCount: 0,
    expectedCount: Object.keys(perServerListNodes).length
  };
  console.log(`🎯 AggregateToolsNode expecting ${aggregateState.expectedCount} tool lists from servers: ${Object.keys(perServerListNodes).join(', ')}`);
  
  class AggregateToolsNode extends CustomNode {
    process(_context: ProcessContext, listToolsResponse: GraphTypes.ListToolsResponse): GraphTypes.ListToolsResponse {
      aggregateState.receivedCount++;
      
      if (listToolsResponse && listToolsResponse.tools) {
        console.log(`📥 AggregateToolsNode - Received list ${aggregateState.receivedCount}/${aggregateState.expectedCount} with ${listToolsResponse.tools.length} tools`);
        
        // Only aggregate if this is the first time we're processing
        if (aggregateState.receivedCount === 1) {
          // Clear on first response
          aggregatedSeenTools.clear();
          aggregatedToolsArray = [];
        }
        
        for (const tool of listToolsResponse.tools) {
          if (!aggregatedSeenTools.has(tool.name)) {
            aggregatedSeenTools.add(tool.name);
            aggregatedToolsArray.push(tool);
            console.log(`   Added tool: ${tool.name}`);
          }
        }
      }
      
      // Only update and return when we've received all expected responses
      if (aggregateState.receivedCount >= aggregateState.expectedCount) {
        console.log(`📈 AggregateToolsNode - All lists received. Total unique tools: ${aggregatedToolsArray.length}`);
        console.log(`   Tools: ${Array.from(aggregatedSeenTools).join(', ')}`);
        availableTools = aggregatedToolsArray;
        aggregateState.receivedCount = 0; // Reset for next execution
        return new GraphTypes.ListToolsResponse({ tools: aggregatedToolsArray });
      }
      
      // Return empty while waiting for more
      return new GraphTypes.ListToolsResponse({ tools: [] });
    }
  }

  // Custom node to convert LLM Content to ToolCallRequest for MCP
  class LLMResponseToToolCallsNode extends CustomNode {
    process(
      _context: ProcessContext,
      content: GraphTypes.Content
    ): GraphTypes.ToolCallRequest {
      console.log('🔄 LLMResponseToToolCallsNode - Converting Content to ToolCallRequest');
      console.log('   Raw content keys:', Object.keys((content as any) || {}).join(', '));
      
      // Store the content for later use in final LLM request
      firstLLMContent = content;
      
      const calls = (content as any).toolCalls || (content as any).tool_calls || [];
      if (Array.isArray(calls) && calls.length > 0) {
        console.log('  🔧 Tool calls found:', calls.map((tc: any) => tc.name).join(', '));
        return new GraphTypes.ToolCallRequest(calls);
      }
      
      console.log('  💭 No tool calls in response (should not reach here with conditional edge)');
      return new GraphTypes.ToolCallRequest([]);
    }
  }

  // Detect which servers have calls in this turn

  // Factory: Filters tool calls for a specific server
  function createFilterToolCallsNode(serverId: string, id: string): CustomNode {
    const capturedServerId = serverId;
    const className = `FilterToolCallsFor${capturedServerId.charAt(0).toUpperCase() + capturedServerId.slice(1)}Node`;
    
    class FilterToolCallsNodeImpl extends CustomNode {
      process(_context: ProcessContext, request: GraphTypes.ToolCallRequest): GraphTypes.ToolCallRequest {
        const names = serverIdToToolNames.get(capturedServerId) || new Set<string>();
        const calls = (request as any).toolCalls || (request as any).tool_calls || [];
        const incoming = calls.map((tc: any) => tc.name);
        const filtered = calls.filter((tc: any) => names.has(tc.name));
        
        console.log(`🧰 Filter server=${capturedServerId} incoming=[${incoming.join(', ')}] matched=[${filtered.map((tc: any) => tc.name).join(', ')}]`);
        
        return new GraphTypes.ToolCallRequest(filtered);
      }
    }
    
    Object.defineProperty(FilterToolCallsNodeImpl, 'name', { value: className });
    return new FilterToolCallsNodeImpl({ id });
  }



  // Factory: Records tools for a specific server
  function createRecordToolsNode(serverId: string, id: string): CustomNode {
    // Capture serverId in closure to ensure it's preserved
    const capturedServerId = serverId;
    console.log(`🏗️ Creating RecordToolsNode for server: ${capturedServerId} with id: ${id}`);
    
    // Create a uniquely named class for each server
    const className = `RecordToolsFor${capturedServerId.charAt(0).toUpperCase() + capturedServerId.slice(1)}Node`;
    
    class RecordToolsNodeImpl extends CustomNode {
      process(_context: ProcessContext, listToolsResponse: GraphTypes.ListToolsResponse): GraphTypes.ListToolsResponse {
        const toolNames = listToolsResponse?.tools?.map(t => t.name) || [];
        console.log(`📋 RecordToolsNode[${capturedServerId}] (id=${id}) received response with ${listToolsResponse?.tools?.length || 0} tools: ${toolNames.join(', ')}`);
        
        // Clear this server's tools first to avoid accumulation and store full specs
        serverIdToToolNames.set(capturedServerId, new Set<string>());
        serverIdToTools.set(capturedServerId, listToolsResponse?.tools || []);
        const set = serverIdToToolNames.get(capturedServerId)!;
        
        if (listToolsResponse && listToolsResponse.tools) {
          for (const tool of listToolsResponse.tools) {
            set.add(tool.name);
          }
          serverIdToToolNames.set(capturedServerId, set);
          console.log(`🗂️ Recorded ${set.size} tools for server ${capturedServerId}: ${Array.from(set).join(', ')}`);
        }
        return listToolsResponse;
      }
    }
    
    // Set the class name for debugging
    Object.defineProperty(RecordToolsNodeImpl, 'name', { value: className });
    
    return new RecordToolsNodeImpl({ id });
  }


  // Custom node to transform tool call results into LLM request
  class ToolCallToLLMRequestNode extends CustomNode {
    async process(
      _context: ProcessContext,
      toolResults: any
    ): Promise<GraphTypes.LLMChatRequest> {
      console.log('📊 ToolCallToLLMRequestNode - Building request with tool results');
      const results = toolResults?.toolCallResults || toolResults?.tool_call_results || [];
      console.log('   tool results count:', Array.isArray(results) ? results.length : 0);
      
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
      for (const result of results) {
        console.log('➕ Adding tool result for:', result.toolCallId || result.tool_call_id);
        messages.push({
          role: 'tool',
          content: result.result,
          toolCallId: result.toolCallId || result.tool_call_id
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
  
  const chunkerNode = new TextChunkingNode({ 
    id: 'chunker_node' 
  });
  
  const ttsNode = new RemoteTTSNode({
    id: 'tts_node',
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
      .addNode(chunkerNode)
      .addNode(ttsNode)
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
          const calls = (content as any).toolCalls || (content as any).tool_calls || [];
          const hasToolCalls = Array.isArray(calls) && calls.length > 0;
          console.log(`🔀 Conditional edge (firstLLM → toolConverter): hasToolCalls=${hasToolCalls}`);
          if (hasToolCalls) {
            console.log(`   Tool calls: ${calls.map((tc: any) => tc.name).join(', ')}`);
          }
          return hasToolCalls;
        },
      })
      // Path 2: If LLM returns just content (no tools), go straight to chunker/TTS
      .addEdge(firstLLMNode, chunkerNode, {
        condition: (content: GraphTypes.Content) => {
          const calls = (content as any).toolCalls || (content as any).tool_calls || [];
          const hasNoToolCalls = !Array.isArray(calls) || calls.length === 0;
          const hasContent = !!(content && (content as any).content);
          const shouldChunk = hasNoToolCalls && hasContent;
          console.log(`🔀 Conditional edge (firstLLM → chunker): hasNoToolCalls=${hasNoToolCalls}, hasContent=${hasContent}, shouldChunk=${shouldChunk}`);
          return shouldChunk;
        },
      })
      
      // Direct path (no tools)
      .addEdge(chunkerNode, ttsNode)
      
      // Set start nodes (STT and list tools)
      .setStartNodes([sttNode]);

    // Add and wire per-server list and call nodes
    const startNodes: any[] = [inputRouterNode];
    
    // Create all record nodes first to ensure they're distinct
    const recordNodes: Record<string, CustomNode> = {};
    for (const serverId of Object.keys(perServerListNodes)) {
      recordNodes[serverId] = createRecordToolsNode(serverId, `${serverId}_record_tools_node`);
    }
    
    // Now wire them
    for (const serverId of Object.keys(perServerListNodes)) {
      const listNode = perServerListNodes[serverId];
      const recordNode = recordNodes[serverId];
      console.log(`📌 Wiring ${serverId}: list(${listNode.id}) -> record(${recordNode.id}) -> aggregate`);
      graphBuilder
        .addNode(listNode)
        .addNode(recordNode)
        .addEdge(listNode, recordNode)
        .addEdge(recordNode, aggregateToolsNode);
      startNodes.push(listNode);
    }
    graphBuilder.setStartNodes(startNodes);

    // Collect all end nodes
    const endNodes = [ttsNode]; // Start with the non-tool path TTS
    
    // Create separate path for each server to avoid conflicts
    for (const serverId of Object.keys(perServerCallNodes)) {
      const filterNode = createFilterToolCallsNode(serverId, `${serverId}_filter_tool_calls_node`);
      const callNode = perServerCallNodes[serverId];
      
      // Create dedicated nodes for this server's path
      const serverToolCallToLLMNode = new ToolCallToLLMRequestNode({ 
        id: `${serverId}_tool_call_to_llm_request_node` 
      });
      const serverFinalLLMNode = new RemoteLLMChatNode({
        id: `${serverId}_final_llm_node`,
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
      const serverChunkerFinalNode = new TextChunkingNode({ 
        id: `${serverId}_chunker_final_node` 
      });
      const serverTtsFinalNode = new RemoteTTSNode({
        id: `${serverId}_tts_final_node`,
        speakerId: 'Diego',
        modelId: 'inworld-tts-1',
        sampleRate: 16000,
        speakingRate: 1,
        temperature: 0.7,
      });
      
      // Add this server's TTS to end nodes
      endNodes.push(serverTtsFinalNode);
      
      graphBuilder
        .addNode(filterNode)
        .addNode(callNode)
        .addNode(serverToolCallToLLMNode)
        .addNode(serverFinalLLMNode)
        .addNode(serverChunkerFinalNode)
        .addNode(serverTtsFinalNode)
        // From LLM response to filter
        .addEdge(llmResponseToToolCallsNode, filterNode)
        // From filter to call (only if has matching tools)
        .addEdge(filterNode, callNode, {
          condition: (request: GraphTypes.ToolCallRequest) => {
            const calls = (request as any).toolCalls || (request as any).tool_calls || [];
            const hasTools = Array.isArray(calls) && calls.length > 0;
            if (hasTools) {
              console.log(`✅ ${serverId} has ${calls.length} matching tool calls, proceeding to call node`);
            }
            return hasTools;
          },
        })
        // Complete path for this server (like working version)
        .addEdge(callNode, serverToolCallToLLMNode)
        .addEdge(serverToolCallToLLMNode, serverFinalLLMNode)
        .addEdge(serverFinalLLMNode, serverChunkerFinalNode)
        .addEdge(serverChunkerFinalNode, serverTtsFinalNode);
    }
    
    // Set all end nodes at once
    graphBuilder.setEndNodes(endNodes);
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