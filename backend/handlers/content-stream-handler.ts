import { GraphTypes } from '@inworld/runtime/common';
import type { ChunkHandler, HandlerContext } from './types.ts';

/**
 * Handles streaming LLM response (ContentStream type)
 */
export const handleContentStream: ChunkHandler<GraphTypes.ContentStream> = async (
  streamIterator: GraphTypes.ContentStream, 
  context: HandlerContext
) => {
  console.log('VAD Processing LLM ContentStream...');
  let currentLLMResponse = '';
  
  for await (const streamChunk of streamIterator) {
    if (streamChunk.text) {
      currentLLMResponse += streamChunk.text;
      // console.log('VAD LLM chunk:', streamChunk.text);
      
      // Send chunk to frontend
      context.sendWebSocketMessage({
        type: 'llm_response_chunk',
        text: streamChunk.text,
        timestamp: Date.now()
      });
    }
  }
  
  if (currentLLMResponse.trim()) {
    context.updateLLMResponse(currentLLMResponse);
    
    console.log(`VAD Complete LLM Response: "${currentLLMResponse}"`);
    
    // Send complete response to frontend
    context.sendWebSocketMessage({
      type: 'llm_response_complete',
      text: currentLLMResponse.trim(),
      timestamp: Date.now()
    });
    
    // Now update conversation state with both user and assistant messages
    // Add user message first (it wasn't added earlier to avoid duplication)
    context.addMessageToConversation({
      role: 'user',
      content: context.transcription.trim(),
      timestamp: new Date().toISOString()
    });
    
    // Then add assistant message
    context.addMessageToConversation({
      role: 'assistant',
      content: currentLLMResponse.trim(),
      timestamp: new Date().toISOString()
    });
    
    console.log('Updated conversation state with full exchange');
    
    // Mark that we'll need to trigger flashcard generation after TTS completes
    // We'll do this after all TTS chunks have been sent
  }
};
