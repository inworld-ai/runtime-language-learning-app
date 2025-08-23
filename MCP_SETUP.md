# MCP (Model Context Protocol) Setup

This application supports multiple MCP servers. The system automatically detects and integrates available MCP servers based on your environment configuration.

## Supported MCP Servers

### 1. Brave Search
Web search integration for finding current information.

**Setup:**
1. Visit [Brave Search API](https://brave.com/search/api/)
2. Sign up for a free account
3. Create a new API key
4. Add to `.env`: `BRAVE_API_KEY=your_brave_api_key_here`

### 2. Weather (AccuWeather)
Weather information and forecasts.

**Setup:**
1. Visit [AccuWeather Developer](https://developer.accuweather.com/)
2. Create a developer account
3. Get your API key
4. Add to `.env`: `ACCUWEATHER_API_KEY=your_accuweather_key_here`

### 3. Exa Search
Advanced neural search capabilities.

**Setup:**
1. Visit [Exa](https://exa.ai/)
2. Sign up for an account
3. Get your API key
4. Add to `.env`: `EXA_API_KEY=your_exa_api_key_here`

## Configuration

### Environment Variables
Add the API keys for the services you want to use to your `.env` file:
```
# Brave Search
BRAVE_API_KEY=your_brave_api_key_here

# AccuWeather
ACCUWEATHER_API_KEY=your_accuweather_key_here

# Exa Search
EXA_API_KEY=your_exa_api_key_here

# Optional: Disable specific MCP servers
# MCP_DISABLE=true           # Disable all MCP servers
# MCP_BRAVE_DISABLE=true      # Disable only Brave
# MCP_WEATHER_DISABLE=true    # Disable only Weather
# MCP_EXA_DISABLE=true        # Disable only Exa
```

### Automatic Installation
MCP servers are automatically downloaded when needed via npx. No manual installation required!

## How It Works

The system automatically:
1. Detects available MCP servers based on environment variables
2. Initializes connections to enabled servers
3. Lists available tools from each server
4. Routes tool calls to the appropriate server
5. Processes results and integrates them into the conversation

## Adding New MCP Servers

To add a new MCP server:

1. **Update `backend/helpers/mcp.ts`:**
   - Add environment variable checks in `initFromEnv()`
   - Configure the server endpoint and environment

2. **Set Environment Variables:**
   - Add the required API keys to `.env`
   - Optionally add disable flags

3. **Test:**
   - Run `npm run test-mcp` to verify the integration
   - The graph will automatically create processing subgraphs for new servers

The system uses a factory pattern to automatically generate the processing pipeline for each MCP server, making it easy to add new integrations without modifying the core graph logic.

## Architecture

- **backend/helpers/mcp.ts**: Centralized MCP server management and configuration
- **backend/graphs/conversation-graph.ts**: Dynamic graph construction with MCP integration
  - `createMCPProcessingSubgraph()`: Factory function for creating server-specific processing pipelines
  - Automatic routing of tool calls to appropriate servers
  - Parallel processing of tool lists from multiple servers

## Troubleshooting

If MCP servers are not working:
1. Check that the required API keys are set in your `.env` file
2. Run `npm run test-mcp` to verify the integration
3. Check console logs for any error messages
4. Ensure npx is installed (`npm install -g npx`)
5. Look for initialization messages like:
   - `✅ MCP nodes initialized via MCPManager for server: [serverId]`
   - `🔧 Enabled MCP servers: brave, weather, exa`

## Notes

- MCP integration is optional. The system works normally without any MCP servers configured.
- Each MCP server is independent - you can enable any combination of servers.
- The graph automatically adapts to available servers at runtime.
- Tool calls are routed intelligently to the appropriate server based on tool names.