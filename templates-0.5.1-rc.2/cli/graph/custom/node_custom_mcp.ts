import 'dotenv/config';

import { LLMMessageInterface } from '@inworld/runtime';
import {
  CustomNode,
  GraphBuilder,
  GraphTypes,
  MCPCallToolNode,
  MCPClientComponent,
  MCPListToolsNode,
  ProcessContext,
  ProxyNode,
  RemoteLLMChatNode,
} from '@inworld/runtime/graph';

import { TEXT_CONFIG_SDK } from '../../constants';
import { bindProcessHandlers, parseArgs } from '../../helpers/cli_helpers';

// System prompt for the tool-calling agent
const SYSTEM_PROMPT = `You are a helpful AI assistant with access to external tools. 
When a user asks a question, you should determine if you need to use any available tools to answer their question.
If you need to use tools, make the appropriate tool calls with the correct parameters.
If you don't need tools, respond directly to the user.`;

const usage = `
Usage:
    yarn node-custom-mcp "What's the weather like in San Francisco?" --modelName=gpt-4o-mini --provider=openai --port=8080
    --help - Show this help message

Instructions:
    In another terminal, run: npx @brave/brave-search-mcp-server --port=8080
    Set BRAVE_API_KEY environment variable with your Brave Search API key.
    You must use a model that supports tool calling.

Example:
    yarn node-custom-mcp "What's the weather like in San Francisco?" --modelName=gpt-4o-mini --provider=openai --port=8080
    yarn node-custom-mcp "What's the google stock price today?" --modelName=gpt-4o-mini --provider=openai --port=8080
`;

run();

async function run() {
  const { prompt, apiKey, modelName, provider, port } = parseArgs(usage);

  // Custom node to combine the user's query with the list of tools from the MCP server
  // to create a LLM request with the available tools.
  class ToolsToLLMRequestNode extends CustomNode {
    process(
      _context: ProcessContext,
      text: string,
      listToolsResponse: GraphTypes.ListToolsResponse,
    ): GraphTypes.LLMChatRequest {
      const messages: LLMMessageInterface[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text },
      ];
      return new GraphTypes.LLMChatRequest({
        messages,
        tools: listToolsResponse.tools,
      });
    }
  }

  // Custom node to convert the LLM response to a tool call request.
  class LLMResponseToToolCallsNode extends CustomNode {
    process(
      _context: ProcessContext,
      content: GraphTypes.Content,
    ): GraphTypes.ToolCallRequest {
      return new GraphTypes.ToolCallRequest(content.toolCalls || []);
    }
  }

  // Custom node to combine the tool call request, user's query, and tool call response
  // to create the final LLM request.
  class ToolResultsToLLMRequestNode extends CustomNode {
    process(
      _context: ProcessContext,
      content: GraphTypes.Content,
      storedQuery: string,
      toolResults: GraphTypes.ToolCallResponse,
    ): GraphTypes.LLMChatRequest {
      const messages: LLMMessageInterface[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: storedQuery },
        {
          role: 'assistant',
          content: content.content,
          toolCalls: content.toolCalls,
        },
      ];
      for (const result of toolResults.toolCallResults) {
        messages.push({
          role: 'tool',
          content: result.result,
          toolCallId: result.toolCallId,
        });
      }
      return new GraphTypes.LLMChatRequest({ messages });
    }
  }

  // Proxy node to pass the user's query to both the first LLM node and the final LLM node.
  const inputNode = new ProxyNode();
  const toolsToLLMRequestNode = new ToolsToLLMRequestNode();
  const llmResponseToToolCallsNode = new LLMResponseToToolCallsNode();
  const toolResultsToLLMRequestNode = new ToolResultsToLLMRequestNode();

  // Set up the MCP client component.
  const mcpComponent = new MCPClientComponent({
    sessionConfig: {
      transport: 'http',
      endpoint: `http://localhost:${port}/mcp`,
      authConfig: {
        type: 'http',
        config: { api_key: '{{BRAVE_API_KEY}}' },
      },
    },
  });
  const listToolsNode = new MCPListToolsNode({ mcpComponent });
  const callToolNode = new MCPCallToolNode({ mcpComponent });

  const firstLLMNode = new RemoteLLMChatNode({
    provider,
    modelName,
    textGenerationConfig: TEXT_CONFIG_SDK,
  });
  const finalLLMNode = new RemoteLLMChatNode({
    provider,
    modelName,
    textGenerationConfig: TEXT_CONFIG_SDK,
  });

  const graph = new GraphBuilder({
    id: 'node_custom_mcp_graph',
    apiKey,
    enableRemoteConfig: false,
  })
    .addNode(inputNode)
    .addNode(toolsToLLMRequestNode)
    .addNode(llmResponseToToolCallsNode)
    .addNode(toolResultsToLLMRequestNode)
    .addNode(listToolsNode)
    .addNode(callToolNode)
    .addNode(firstLLMNode)
    .addNode(finalLLMNode)
    .addEdge(inputNode, toolsToLLMRequestNode)
    .addEdge(listToolsNode, toolsToLLMRequestNode)
    .addEdge(toolsToLLMRequestNode, firstLLMNode)
    .addEdge(firstLLMNode, llmResponseToToolCallsNode)
    .addEdge(llmResponseToToolCallsNode, callToolNode)
    .addEdge(firstLLMNode, toolResultsToLLMRequestNode)
    .addEdge(inputNode, toolResultsToLLMRequestNode)
    .addEdge(callToolNode, toolResultsToLLMRequestNode)
    .addEdge(toolResultsToLLMRequestNode, finalLLMNode)
    .setStartNodes([inputNode, listToolsNode])
    .setEndNode(finalLLMNode)
    .build();

  const outputStream = graph.start(prompt);
  for await (const result of outputStream) {
    result.processResponse({
      Content: (content: GraphTypes.Content) => {
        console.log('\n✅ Agent response:');
        console.log(content);
      },
    });
  }
}

bindProcessHandlers();
