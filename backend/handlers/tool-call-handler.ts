import { GraphTypes } from '@inworld/runtime/common';
import type { ChunkHandler, HandlerContext } from './types.ts';

/**
 * Handles ToolCallResponse to notify frontend about tool usage
 */
export const handleToolCallResponse: ChunkHandler<GraphTypes.ToolCallResponse> = async (
  toolResponse: GraphTypes.ToolCallResponse,
  context: HandlerContext
) => {
  console.log('Processing ToolCallResponse...');
  
  if (toolResponse.toolCallResults && toolResponse.toolCallResults.length > 0) {
    for (const result of toolResponse.toolCallResults) {
      console.log(`Tool call completed: ${result.toolCallId}`);
      
      // Send tool completion notification to frontend
      context.sendWebSocketMessage({
        type: 'tool_call_complete',
        toolCallId: result.toolCallId,
        timestamp: Date.now()
      });
    }
  }
};

/**
 * Handles tool call initiation from Content responses
 */
export const handleToolCallInitiation = (
  content: GraphTypes.Content,
  context: HandlerContext
) => {
  if (content.toolCalls && content.toolCalls.length > 0) {
    for (const toolCall of content.toolCalls) {
      console.log(`Tool call initiated: ${toolCall.name} (${toolCall.id})`);
      
      // Send tool call notification to frontend
      context.sendWebSocketMessage({
        type: 'tool_call_initiated',
        toolName: toolCall.name,
        toolCallId: toolCall.id,
        timestamp: Date.now()
      });
    }
  }
};
