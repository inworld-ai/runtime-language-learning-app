import { GraphTypes } from '@inworld/runtime/common';
import type { ChunkHandler, HandlerContext } from './types.ts';

/**
 * Handles non-streaming LLM response (Content type)
 */
export const handleContent: ChunkHandler<GraphTypes.Content> = async (
  content: GraphTypes.Content, 
  context: HandlerContext
) => {
  console.log('VAD Processing LLM Content...');
  console.log(content);
  
  if (content.content) {
    const llmResponse = content.content;
    context.updateLLMResponse(llmResponse);
    
    console.log(`VAD Complete LLM Response: "${llmResponse}"`);
    
    // Send complete response to frontend
    context.sendWebSocketMessage({
      type: 'llm_response_complete',
      text: llmResponse,
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
      content: llmResponse.trim(),
      timestamp: new Date().toISOString()
    });
    
    console.log('Updated conversation state with full exchange');
    
    // Trigger flashcard generation after updating conversation state
    if (context.transcription && llmResponse) {
      console.log('Triggering flashcard generation after Content response');
      
      // Send conversation update and trigger flashcard generation
      context.triggerFlashcardGeneration();
      
      // Run introduction-state extraction while incomplete
      context.triggerIntroductionStateExtraction();
    }
  }
};
