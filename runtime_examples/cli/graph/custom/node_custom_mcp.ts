import 'dotenv/config';

import {
  ContentInterface,
  LLMChatRequestInterface,
} from '@inworld/runtime/common';
import {
  ComponentFactory,
  CustomInputDataType,
  CustomOutputDataType,
  GraphBuilder,
  NodeFactory,
  registerCustomNodeType,
} from '@inworld/runtime/graph';
import { LLMMessageInterface } from '@inworld/runtime/primitives/llm';
import { v4 } from 'uuid';

import { TEXT_CONFIG_SDK } from '../../constants';
import {
  bindProcessHandlers,
  cleanup,
  parseArgs,
} from '../../helpers/cli_helpers';

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
`;

run();

async function run() {
  const { prompt, apiKey, modelName, provider, port } = parseArgs(usage);

  // build the first llm request based on the user query and available tools
  const toolsToLlmRequestNodeType = registerCustomNodeType(
    'ToolsToLLMRequestNode',
    [CustomInputDataType.TEXT, CustomInputDataType.LIST_TOOLS],
    CustomOutputDataType.CHAT_REQUEST,
    (_context, text, tools) => {
      const userQuery = text;

      const messages: LLMMessageInterface[] = [
        {
          role: 'system',
          content: SYSTEM_PROMPT,
          toolCalls: [],
          toolCallId: undefined,
        },
        {
          role: 'user',
          content: userQuery,
          toolCalls: [],
          toolCallId: undefined,
        },
      ];

      return {
        messages,
        tools: tools.list_tools.map((tool) => tool.tool),
        toolChoice: undefined,
      } as LLMChatRequestInterface;
    },
  );

  const llmResponseToToolCallsNodeType = registerCustomNodeType(
    'LLMResponseToToolCallsNode',
    [CustomInputDataType.CONTENT],
    CustomOutputDataType.TOOL_CALLS,
    (_context, content) => {
      const toolCalls = content.toolCalls;

      return toolCalls;
    },
  );

  /**
   * This node is used to build the next llm request based on the tool results
   * It takes this turn's assistant response, original user query (can be extended to full conversation history),
   * and tool results as input.
   */
  const toolResultsToLLMRequestNodeType = registerCustomNodeType(
    'ToolResultsToLLMRequestNode',
    [
      CustomInputDataType.CONTENT,
      CustomInputDataType.TEXT,
      CustomInputDataType.TOOL_CALLS_RESULTS,
    ],
    CustomOutputDataType.CHAT_REQUEST,
    (_context, content, storedQuery, toolResults) => {
      const assistantContent = content.content;
      const toolCalls = content.toolCalls;

      // Build conversation history
      const messages = [
        {
          role: 'system',
          content: SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: storedQuery,
        },
        {
          role: 'assistant',
          content: assistantContent,
          toolCalls: toolCalls,
        },
      ] as LLMMessageInterface[];

      // Add tool results as tool messages
      for (const result of toolResults) {
        messages.push({
          role: 'tool',
          content: result.result,
          toolCalls: [],
          toolCallId: result.toolCallId,
        });
      }

      console.log('final LLM request', messages);
      return {
        messages,
        tools: [],
        toolChoice: undefined,
      } as LLMChatRequestInterface;
    },
  );

  // proxy the user query for llm requests used in this interaction
  // can be extended to full conversation history
  const inputNode = NodeFactory.createProxyNode({
    id: 'input_node',
  });

  const toolsToLLMRequestNode = NodeFactory.createCustomNode(
    'ToolsToLLMRequestNode',
    toolsToLlmRequestNodeType,
  );

  const llmResponseToToolCallsNode = NodeFactory.createCustomNode(
    'LLMResponseToToolCallsNode',
    llmResponseToToolCallsNodeType,
  );

  const toolResultsToLLMRequestNode = NodeFactory.createCustomNode(
    'ToolResultsToLLMRequestNode',
    toolResultsToLLMRequestNodeType,
  );

  const listToolsNode = NodeFactory.createMCPListToolsNode({
    id: 'mcp_list_tools_node',
    mcpComponentId: 'mcp_component',
  });

  const callToolNode = NodeFactory.createMCPCallToolNode({
    id: 'mcp_call_tool_node',
    mcpComponentId: 'mcp_component',
  });

  const firstLLMNode = NodeFactory.createRemoteLLMChatNode({
    id: `first_llm_node`,
    executionConfig: {
      llmComponentId: 'llm_component',
      textGenerationConfig: TEXT_CONFIG_SDK,
      stream: false,
    },
  });

  const finalLLMNode = NodeFactory.createRemoteLLMChatNode({
    id: `final_llm_node`,
    executionConfig: {
      llmComponentId: 'llm_component',
      textGenerationConfig: TEXT_CONFIG_SDK,
      stream: false,
      reportToClient: true,
    },
  });

  const llmComponent = ComponentFactory.createRemoteLLMComponent({
    id: 'llm_component',
    provider,
    modelName,
    apiKey,
    defaultConfig: TEXT_CONFIG_SDK,
  });

  const mcpComponent = ComponentFactory.createMCPClientComponent({
    id: 'mcp_component',
    sessionConfig: {
      transport: 'http',
      endpoint: `http://localhost:${port}/mcp`,
      authConfig: {
        type: 'http',
        config: {
          api_key: '{{BRAVE_API_KEY}}',
        },
      },
    },
  });

  const executor = new GraphBuilder('node_custom_mcp_graph')
    .addComponent(llmComponent)
    .addComponent(mcpComponent)
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
    .getExecutor();

  console.log('🚀 Starting tool-calling agent...');

  const outputStream = await executor.execute(prompt, v4());
  const nextResult = await outputStream.next();
  const result = nextResult.data as ContentInterface;

  console.log('\n✅ Agent response:');
  console.log(result);
  console.log('Press Ctrl+C to stop the server and exit this template');

  cleanup(executor, outputStream);
}

bindProcessHandlers();
