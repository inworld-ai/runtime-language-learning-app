// iOS Audio Handler interface
export interface IOSAudioHandler {
  unlockAudioContext?: () => Promise<void>;
  startMicrophone?: (callback: (data: string) => void) => Promise<boolean>;
  stopMicrophone?: () => void;
  playAudioChunk?: (data: string, isLastChunk: boolean) => Promise<void>;
  stopAudioPlayback?: () => void;
  getOptimizedWebSocketURL?: () => string | null;
}

// Connection status
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

// Message role
export type MessageRole = 'learner' | 'teacher';

// Chat message for UI display
export interface ChatMessage {
  role: MessageRole;
  content: string;
  timestamp?: string;
}

// Conversation message for backend
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface ConversationHistory {
  messages: ConversationMessage[];
}

// Flashcard
export interface Flashcard {
  targetWord: string;
  english: string;
  example: string;
  mnemonic: string;
  timestamp?: string;
  languageCode?: string;
  // Legacy fields for backward compatibility
  spanish?: string;
  word?: string;
  translation?: string;
  example_sentence?: string;
}

// Language
export interface Language {
  code: string;
  name: string;
  nativeName: string;
  flag: string;
}

// Audio stream data
export interface AudioStreamData {
  audio: string;
  audioFormat: 'int16' | 'float32';
  sampleRate: number;
  timestamp?: string;
  text?: string;
}

// WebSocket event payloads
export interface TranscriptUpdatePayload {
  text: string;
}

export interface TranscriptionPayload {
  text: string;
  timestamp?: string;
}

export interface LLMResponseChunkPayload {
  text: string;
  timestamp?: string;
}

export interface LLMResponseCompletePayload {
  text: string;
  timestamp?: string;
}

export interface SpeechDetectedPayload {
  text?: string;
  interactionId?: string;
}

export interface PartialTranscriptPayload {
  text: string;
  interactionId?: string;
  timestamp?: string;
}

export interface InterruptPayload {
  reason?: string;
}

export interface LanguageChangedPayload {
  languageCode: string;
  languageName: string;
}

export interface FeedbackGeneratedPayload {
  messageContent: string;
  feedback: string;
}

// App state
export interface AppState {
  // Connection
  connectionStatus: ConnectionStatus;

  // Language
  currentLanguage: string;
  availableLanguages: Language[];

  // Chat
  chatHistory: ChatMessage[];
  currentTranscript: string;
  pendingTranscription: string | null;
  streamingLLMResponse: string;
  llmResponseComplete: boolean;
  currentResponseId: string | null;

  // Recording
  isRecording: boolean;
  speechDetected: boolean;

  // Flashcards
  flashcards: Flashcard[];

  // Feedback (keyed by user message content)
  feedbackMap: Record<string, string>;

  // User
  userId: string;
}

// Outgoing WebSocket message
export interface OutgoingMessage {
  type: string;
  [key: string]: unknown;
}
