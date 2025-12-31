/**
 * Types for the 0.9 long-running graph architecture
 */

import { WebSocket } from 'ws';
import type { MultimodalStreamManager } from '../helpers/multimodal-stream-manager.js';
import type { GraphOutputStream } from '@inworld/runtime/graph';

/**
 * Chat message in conversation history
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

/**
 * Connection state for a session
 * This is the central state object that graph nodes read from
 */
export interface State {
  interactionId: string;
  messages: ChatMessage[];
  voiceId?: string;
  // Language learning specific
  userName: string;
  targetLanguage: string;
  languageCode: string;
  // Output modalities (for graph routing)
  output_modalities: ('text' | 'audio')[];
}

/**
 * Connection object for a WebSocket session
 */
export interface Connection {
  ws: WebSocket;
  state: State;
  unloaded?: true;
  multimodalStreamManager?: MultimodalStreamManager;
  currentAudioGraphExecution?: Promise<void>;
  currentAudioExecutionStream?: GraphOutputStream;
  onSpeechDetected?: (interactionId: string) => void;
  onPartialTranscript?: (text: string, interactionId: string) => void;
  // Utterance stitching support
  pendingTranscript?: string; // Stores transcript from interrupted turn for stitching
  isProcessingInterrupted?: boolean; // Flag to stop current LLM/TTS processing
}

/**
 * Map of session IDs to connections
 */
export type ConnectionsMap = { [sessionId: string]: Connection };

/**
 * Text input passed between graph nodes
 */
export interface TextInput {
  sessionId: string;
  text: string;
  interactionId: string;
  voiceId?: string;
}

/**
 * Interaction info extracted from STT
 */
export interface InteractionInfo {
  sessionId: string;
  interactionId: string;
  text: string;
  interactionComplete: boolean;
}

/**
 * Config constants
 */
export const INPUT_SAMPLE_RATE = 16000;
// Inworld TTS typically outputs at 22050Hz
export const TTS_SAMPLE_RATE = 22050;
