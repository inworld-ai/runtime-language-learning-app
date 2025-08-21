import type { 
  HandlerContext, 
  ConversationState, 
  ConversationMessage 
} from './types.ts';
import type { IntroductionState } from '../helpers/introduction-state-processor.ts';

export class HandlerContextImpl implements HandlerContext {
  public transcription: string = '';
  public llmResponse: string = '';
  
  constructor(
    public websocket: any,
    public conversationState: ConversationState,
    public introductionState: IntroductionState,
    public graphStartTime: number,
    public flashcardCallback: ((messages: Array<{ role: string; content: string }>) => Promise<void>) | null,
    public introductionStateCallback: ((messages: Array<{ role: string; content: string }>) => Promise<IntroductionState | null>) | null,
    private trimConversationHistory: (maxTurns: number) => void
  ) {}

  updateTranscription(text: string): void {
    this.transcription = text;
  }

  updateLLMResponse(text: string): void {
    this.llmResponse = text;
  }

  addMessageToConversation(message: ConversationMessage): void {
    this.conversationState.messages.push(message);
    this.trimConversationHistory(40);
  }

  updateIntroductionState(state: IntroductionState): void {
    this.introductionState = state;
  }

  sendWebSocketMessage(message: any): void {
    if (this.websocket) {
      try {
        this.websocket.send(JSON.stringify(message));
      } catch (error) {
        console.error('Error sending WebSocket message:', error);
      }
    }
  }

  triggerFlashcardGeneration(): void {
    if (this.transcription && this.llmResponse) {
      console.log('Triggering flashcard generation');
      
      // Send conversation update to frontend
      this.sendWebSocketMessage({
        type: 'conversation_update',
        messages: this.conversationState.messages,
        timestamp: Date.now()
      });
      
      // Generate flashcards - fire and forget
      if (this.flashcardCallback) {
        const recentMessages = this.conversationState.messages.slice(-6).map(msg => ({
          role: msg.role,
          content: msg.content
        }));
        
        this.flashcardCallback(recentMessages).catch(error => {
          console.error('Error in flashcard generation callback:', error);
        });
      }
    }
  }

  triggerIntroductionStateExtraction(): void {
    const isIntroComplete = Boolean(
      this.introductionState?.name && 
      this.introductionState?.level && 
      this.introductionState?.goal
    );
    
    if (!isIntroComplete && this.introductionStateCallback) {
      const recentMessages = this.conversationState.messages.slice(-6).map(msg => ({
        role: msg.role,
        content: msg.content
      }));
      
      this.introductionStateCallback(recentMessages)
        .then((state) => {
          if (state) {
            this.updateIntroductionState(state);
            this.sendWebSocketMessage({
              type: 'introduction_state_updated',
              introduction_state: this.introductionState,
              timestamp: Date.now()
            });
          }
        })
        .catch((error) => {
          console.error('Error in introduction-state callback:', error);
        });
    }
  }
}
