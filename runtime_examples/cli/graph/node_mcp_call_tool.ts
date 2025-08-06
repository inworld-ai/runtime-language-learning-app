import 'dotenv/config';

import { ToolCallResultInterface } from '@inworld/runtime/common';
import {
  ComponentFactory,
  GraphBuilder,
  NodeFactory,
} from '@inworld/runtime/graph';
import { v4 } from 'uuid';

import {
  bindProcessHandlers,
  cleanup,
  findNpxPath,
} from '../helpers/cli_helpers';

const minimist = require('minimist');

const createMCPComponent = (serverType: string, port: number) => {
  switch (serverType) {
    case 'everything':
      return ComponentFactory.createMCPClientComponent({
        id: 'mcp_component',
        sessionConfig: {
          transport: 'http',
          endpoint: `http://localhost:${port}/mcp`,
          authConfig: {
            type: 'http',
            config: {
              api_key: 'fake_api_key',
            },
          },
        },
      });

    case 'brave':
      return ComponentFactory.createMCPClientComponent({
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

    case 'brave-stdio':
      const npxPath = findNpxPath();
      return ComponentFactory.createMCPClientComponent({
        id: 'mcp_component',
        sessionConfig: {
          transport: 'stdio',
          endpoint: `${npxPath} -y @modelcontextprotocol/server-brave-search`,
          authConfig: {
            type: 'stdio',
            config: {
              env: {
                BRAVE_API_KEY: '{{BRAVE_API_KEY}}',
              },
            },
          },
        },
      });

    default:
      throw new Error(
        `Unknown server type: ${serverType}. Use 'everything', 'brave-stdio' or 'brave'`,
      );
  }
};

const createExecutor = (serverType: string, port: number) => {
  const mcpComponent = createMCPComponent(serverType, port);

  const callToolNode = NodeFactory.createMCPCallToolNode({
    id: 'mcp_call_tool_node',
    mcpComponentId: 'mcp_component',
    reportToClient: true,
  });

  return new GraphBuilder('node_mcp_call_tool_graph')
    .addComponent(mcpComponent)
    .addNode(callToolNode)
    .setStartNode(callToolNode)
    .setEndNode(callToolNode)
    .getExecutor();
};

const usage = `
Usage:
    yarn node-mcp-call-tool [--server=everything|brave-stdio|brave] [--port=<port>] [--help]

Options:
    --server    MCP server to use: 'everything' (default), 'brave-stdio' or 'brave'.
    --port      Port for the 'everything' HTTP server (default: 3001).

Setup Instructions:
    Ensure npx is installed: npm install -g npx

    For 'everything' server:
        Run in another terminal: npx @modelcontextprotocol/server-everything streamableHttp --port=3001
                
    For 'brave' server:
        Run in another terminal: npx @brave/brave-search-mcp-server --port=8080
        Set BRAVE_API_KEY environment variable with your Brave Search API key.

    For 'brave-stdio' server:
        stdio is not supported on Windows.
        Set BRAVE_API_KEY environment variable with your Brave Search API key.
        
Examples:
    yarn node-mcp-call-tool --server=everything --port=3001
    yarn node-mcp-call-tool --server=brave --port=8080
    yarn node-mcp-call-tool --server=brave-stdio`;

function parseArgs(): {
  serverType: string;
  port: number;
  help: boolean;
} {
  const argv = minimist(process.argv.slice(2));

  const help = !!argv.help;
  const serverType = argv.server || 'everything';
  const port = parseInt(argv.port || '3001', 10);

  if (!['everything', 'brave-stdio', 'brave'].includes(serverType)) {
    console.error(
      `Error: Invalid server type '${serverType}'. Use 'everything', 'brave-stdio' or 'brave'.`,
    );
    console.log(usage);
    process.exit(1);
  }

  return { serverType, port, help };
}

run();

async function run() {
  const { serverType, port, help } = parseArgs();

  if (help) {
    console.log(usage);
    process.exit(0);
  }

  if (serverType === 'everything') {
    console.log(`Make sure to run the server on port ${port}.`);
    console.log(
      'Example: npx @modelcontextprotocol/server-everything streamableHttp',
    );
  }

  const executor = createExecutor(serverType, port);

  let toolCalls;

  if (serverType === 'everything') {
    toolCalls = [
      {
        id: '1',
        name: 'add',
        args: '{"a": 1, "b": 2}',
      },
      {
        id: '2',
        name: 'echo',
        args: '{"message": "Echo test"}',
      },
    ];
  } else if (serverType === 'brave') {
    toolCalls = [
      {
        id: '1',
        name: 'brave_web_search',
        args: '{"query": "What is the capital of France?"}',
      },
    ];
  }

  const outputStream = await executor.execute(toolCalls, v4());
  const result = await outputStream.next();
  if (result.data) {
    if (result.type === 'TOOL_CALLS_RESULTS') {
      const toolCallResults = result.data as ToolCallResultInterface[];
      console.log(`\nTool call results from ${serverType} server:`);
      for (const toolCallResult of toolCallResults) {
        console.log('✓ Tool call id:', toolCallResult.toolCallId);
        console.log('  Result:', toolCallResult.result);
        console.log('');
      }
    } else {
      throw new Error(`Result is not TOOL_CALLS_RESULTS: ${result.data}`);
    }
  } else {
    throw new Error(`No data received from TOOL_CALLS_RESULTS`);
  }

  if (serverType === 'brave') {
    console.log('Press Ctrl+C to stop the server and exit this template');
  }

  cleanup(executor, outputStream);
}

bindProcessHandlers();
