import { GraphTypes } from '@inworld/runtime/common';
import type { IntroductionState } from '../helpers/introduction-state-processor.ts';

export interface ConversationMessage {
  role: string;
  content: string;
  timestamp: string;
}

export interface ConversationState {
  messages: ConversationMessage[];
}

export interface HandlerContext {
  websocket: any;
  conversationState: ConversationState;
  introductionState: IntroductionState;
  transcription: string;
  llmResponse: string;
  graphStartTime: number;
  flashcardCallback: ((messages: Array<{ role: string; content: string }>) => Promise<void>) | null;
  introductionStateCallback: ((messages: Array<{ role: string; content: string }>) => Promise<IntroductionState | null>) | null;
  
  // Methods that handlers can call
  updateTranscription: (text: string) => void;
  updateLLMResponse: (text: string) => void;
  addMessageToConversation: (message: ConversationMessage) => void;
  updateIntroductionState: (state: IntroductionState) => void;
  triggerFlashcardGeneration: () => void;
  triggerIntroductionStateExtraction: () => void;
  sendWebSocketMessage: (message: any) => void;
}

export type ChunkHandler<T> = (data: T, context: HandlerContext) => Promise<void>;
