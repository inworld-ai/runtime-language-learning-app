import 'dotenv/config';

import {
  GraphBuilder,
  GraphTypes,
  MCPClientComponent,
  MCPListToolsNode,
} from '@inworld/runtime/graph';

import { bindProcessHandlers, findNpxPath } from '../helpers/cli_helpers';

const minimist = require('minimist');

const createMCPComponent = (serverType: string, port: number) => {
  const npxPath = findNpxPath();
  switch (serverType) {
    case 'everything':
      return new MCPClientComponent({
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

    case 'brave-stdio':
      return new MCPClientComponent({
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

    case 'brave':
      return new MCPClientComponent({
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

    default:
      throw new Error(
        `Unknown server type: ${serverType}. Use 'everything', 'brave-stdio' or 'brave'`,
      );
  }
};

const createGraph = (serverType: string, port: number) => {
  const mcpComponent = createMCPComponent(serverType, port);

  const listToolsNode = new MCPListToolsNode({
    mcpComponent,
    reportToClient: true,
  });

  return new GraphBuilder({
    id: 'node_mcp_list_tools_graph',
    apiKey: process.env.INWORLD_API_KEY || '',
    enableRemoteConfig: false,
  })
    .addNode(listToolsNode)
    .setStartNode(listToolsNode)
    .setEndNode(listToolsNode)
    .build();
};

const usage = `
Usage:
    yarn node-mcp-list-tools [--server=everything|brave-stdio|brave] [--port=<port>] [--help]

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
    yarn node-mcp-list-tools --server=everything --port=3001
    yarn node-mcp-list-tools --server=brave --port=8080
    yarn node-mcp-list-tools --server=brave-stdio`;

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

  const graph = createGraph(serverType, port);

  const outputStream = graph.start('');
  for await (const result of outputStream) {
    result.processResponse({
      ListToolsResponse: (listToolsResponse: GraphTypes.ListToolsResponse) => {
        console.log(`\nAvailable tools from ${serverType} server:`);
        for (const tool of listToolsResponse.tools) {
          console.log('✓ Tool name:', tool.name);
          console.log('  Description:', tool.description);
          console.log('  Properties:', tool.properties);
          console.log('');
        }
      },
      default: (data: any) => {
        throw new Error(
          `Result is not LIST_TOOLS_DATA: ${JSON.stringify(data)}`,
        );
      },
    });
  }

  if (serverType === 'brave-stdio') {
    console.log('Press Ctrl+C to stop the server and exit this template');
  }
}

bindProcessHandlers();
