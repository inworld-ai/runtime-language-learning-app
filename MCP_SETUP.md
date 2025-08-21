# MCP (Model Context Protocol) Setup for Brave Search

This application now supports Brave search integration through MCP. When users ask questions like "search brave for mexican novellas coming out in 2025", the system will automatically perform a web search and incorporate the results into the conversation.

## Setup Instructions

### 1. Get a Brave Search API Key
1. Visit [Brave Search API](https://brave.com/search/api/)
2. Sign up for a free account
3. Create a new API key

### 2. Configure Environment Variable
Add your Brave API key to the `.env` file:
```
BRAVE_API_KEY=your_brave_api_key_here
```

### 3. Install Dependencies
The MCP server for Brave search will be automatically downloaded when needed via npx.

## Testing the Integration

Run the test script to verify MCP is working:
```bash
npm run test-mcp
```

This will test various search query patterns and show you the results.

## How It Works

When a user's message contains search-related keywords and patterns, the system will:
1. Detect the search intent
2. Execute a Brave web search via MCP
3. Format the search results
4. Include them in the conversation context
5. Generate a response based on the search results

## Supported Query Patterns

The system recognizes various search patterns:
- "search brave for [query]"
- "brave search [query]"
- "look up [query] on brave"
- "find [query] on the web"
- "search for [query]"
- "what is [query] according to the web"

## Architecture

- **mcp-processor.ts**: Handles MCP initialization, tool detection, and execution
- **conversation-graph.ts**: Integrates MCP results into the conversation flow
- **audio-processor.ts**: Initializes MCP during startup

## Troubleshooting

If search is not working:
1. Check that BRAVE_API_KEY is set in your .env file
2. Run `npm run test-mcp` to verify the integration
3. Check console logs for any error messages
4. Ensure npx is installed (`npm install -g npx`)

## Note

The MCP integration is optional. If no BRAVE_API_KEY is provided, the system will continue to work normally without search capabilities.