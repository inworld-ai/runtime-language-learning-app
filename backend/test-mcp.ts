import 'dotenv/config';
import { createTestConversationGraph } from './graphs/test-conversation-graph.js';
import { GraphTypes } from '@inworld/runtime/common';
import type { IntroductionStateLevel } from './helpers/introduction-state-processor.ts';

async function testMCP() {
  console.log('🧪 Testing MCP Integration in Conversation Graph...\n');
  
  if (!process.env.BRAVE_API_KEY) {
    console.error('❌ BRAVE_API_KEY not set in .env file');
    console.log('Please add BRAVE_API_KEY=your_key_here to your .env file');
    process.exit(1);
  }
  
  // Create a mock conversation state
  const mockConversationState = {
    messages: []
  };
  
  const mockIntroductionState = {
    name: 'Test User',
    level: 'intermediate' as IntroductionStateLevel,
    goal: 'practice conversation',
    timestamp: new Date().toISOString()
  };
  
  // Create the test conversation graph (without STT/TTS)
  console.log('Creating test conversation graph with MCP support...');
  const graph = createTestConversationGraph(
    { apiKey: process.env.INWORLD_API_KEY || '' },
    () => mockConversationState,
    () => mockIntroductionState
  );
  
  // Test queries
  const testQueries = [
    'search brave for mexican novellas coming out in 2025',
    'what is the weather like in San Francisco today?',
    'brave search latest AI developments',
    'Hello, how are you today?', // Non-search query
    'find information about TypeScript best practices'
  ];
  
  console.log('\nTesting various inputs through the conversation graph:\n');
  console.log('=' .repeat(60));
  
  for (const query of testQueries) {
    console.log(`\n📝 TEST INPUT: "${query}"`);
    console.log('-'.repeat(60));
    
    try {
      // Start the graph with the test query (simulating STT output)
      const outputStream = graph.start(query);
      
      let toolCallDetected = false;
      let toolCallName = '';
      let toolCallQuery = '';
      let llmResponse = '';
      
      for await (const result of outputStream) {
        result.processResponse({
          string: (_text: string) => {
            console.log('  ➡️ Proxy: User transcript received');
          },
          ListToolsResponse: (toolsResponse: GraphTypes.ListToolsResponse) => {
            console.log('  🔧 Tools available:', toolsResponse.tools.map(t => t.name).join(', '));
          },
          Content: (content: GraphTypes.Content) => {
            if (content.toolCalls && content.toolCalls.length > 0) {
              toolCallDetected = true;
              toolCallName = content.toolCalls[0].name;
              // Access the args property
              const args = content.toolCalls[0].args;
              if (args) {
                try {
                  const parsedArgs = JSON.parse(args);
                  toolCallQuery = parsedArgs.query || 'N/A';
                } catch {
                  toolCallQuery = args;
                }
              }
              console.log(`  🎯 Tool call generated: ${toolCallName}("${toolCallQuery}")`);
            }
            if (content.content) {
              llmResponse = content.content;
              console.log('  💬 LLM Response (preview):');
              console.log('     "' + content.content.substring(0, 100).replace(/\n/g, ' ') + '..."');
            }
          },
          ToolCallResponse: (toolResponse: GraphTypes.ToolCallResponse) => {
            if (toolResponse.toolCallResults && toolResponse.toolCallResults.length > 0) {
              console.log('  ✅ Tool call completed, results received');
              // Show a snippet of the results
              const result = toolResponse.toolCallResults[0].result;
              if (result) {
                try {
                  const parsed = JSON.parse(result);
                  if (parsed.web && parsed.web.results && parsed.web.results.length > 0) {
                    console.log(`  📊 Found ${parsed.web.results.length} search results`);
                    console.log(`     First result: "${parsed.web.results[0].title}"`);
                  }
                } catch {
                  console.log('  📊 Tool returned results (non-JSON format)');
                }
              }
            }
          },
          default: (_data: any) => {
            // Other message types we don't need to log for this test
          }
        });
      }
      
      // Summary for this test
      console.log('\n  📋 SUMMARY:');
      if (toolCallDetected) {
        console.log(`     ✓ Tool call: ${toolCallName}("${toolCallQuery}")`);
      } else {
        console.log('     ✓ No tool calls (regular conversation)');
      }
      if (llmResponse) {
        console.log('     ✓ LLM response received');
      }
      
    } catch (error) {
      console.error('  ❌ Error processing query:', error);
    }
    
    console.log('=' .repeat(60));
  }
  
  console.log('\n\n✨ All tests complete!');
  console.log('Note: The MCP server process may continue running in the background.');
  console.log('Press Ctrl+C to exit completely.\n');
  
  // Give time for any background processes to complete
  setTimeout(() => {
    process.exit(0);
  }, 3000);
}

testMCP().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});