import type { ChunkHandler, HandlerContext } from './types.ts';

/**
 * Handles string output from ProxyNode with STT transcription
 */
export const handleString: ChunkHandler<string> = async (data: string, context: HandlerContext) => {
  const transcription = data;
  context.updateTranscription(transcription);
  
  console.log(`VAD STT Transcription (via ProxyNode): "${transcription}"`);
  
  // Send transcription to frontend
  context.sendWebSocketMessage({
    type: 'transcription',
    text: transcription.trim(),
    timestamp: Date.now()
  });
  
  // Don't add to conversation state yet - the prompt template will use it as current_input
  // We'll add it after processing completes
  
  // Opportunistically run introduction-state extraction as soon as we have user input
  const isIntroCompleteEarly = Boolean(
    context.introductionState?.name && 
    context.introductionState?.level && 
    context.introductionState?.goal
  );
  
  if (!isIntroCompleteEarly && context.introductionStateCallback) {
    const recentMessages = context.conversationState.messages.slice(-6).map(msg => ({
      role: msg.role,
      content: msg.content
    }));
    
    context.introductionStateCallback(recentMessages)
      .then((state) => {
        if (state) {
          context.updateIntroductionState(state);
          context.sendWebSocketMessage({
            type: 'introduction_state_updated',
            introduction_state: context.introductionState,
            timestamp: Date.now()
          });
        }
      })
      .catch((error) => {
        console.error('Error in introduction-state callback (early):', error);
      });
  }
};
