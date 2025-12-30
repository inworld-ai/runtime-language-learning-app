import { AudioChunkInterface } from '@inworld/runtime/common';
import { GraphOutputStream } from '@inworld/runtime/graph';

import { MultimodalStreamManager } from '../components/audio/multimodal_stream_manager';

export enum EVENT_TYPE {
  TEXT = 'TEXT',
  AUDIO = 'AUDIO',
  AUDIO_SESSION_END = 'audioSessionEnd',
  NEW_INTERACTION = 'newInteraction',
  CANCEL_RESPONSE = 'CANCEL_RESPONSE',
}

export enum AUDIO_SESSION_STATE {
  PROCESSING = 'PROCESSING',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export interface ChatMessage {
  id: string;
  role: string;
  content: string;
  tool_call_id?: string; // For tool/function call outputs
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  motivation: string;
  knowledge?: string[];
}

export interface TextInput {
  sessionId: string;
  text: string;
  interactionId: string;
  voiceId?: string;
}

export interface AudioInput {
  sessionId: string;
  audio: AudioChunkInterface;
  state: State;
  interactionId: string;
}

export interface AudioStreamInput {
  sessionId: string;
  state: State;
  voiceId?: string;
}

export interface State {
  interactionId: string;
  agent: Agent;
  userName: string;
  messages: ChatMessage[];
  voiceId?: string;
  tools?: any[];
  toolChoice?: string | object;
  eagerness?: 'low' | 'medium' | 'high';
  output_modalities?: ('text' | 'audio')[];
}

export interface Connection {
  apiKey: string;
  workspaceId: string;
  state: State;
  ws: any;
  unloaded?: true;
  multimodalStreamManager?: MultimodalStreamManager;
  currentAudioGraphExecution?: Promise<void>;
  // Track execution streams so they can be aborted
  currentAudioExecutionStream?: GraphOutputStream;
  onSpeechDetected?: (interactionId: string) => void; // Callback when speech is detected (triggers input_audio_buffer.speech_started event)
  onPartialTranscript?: (text: string, interactionId: string) => void; // Callback for partial transcripts
}

export type ConnectionsMap = {
  [sessionId: string]: Connection;
};

export interface PromptInput {
  agent: Agent;
  messages: ChatMessage[];
  userName: string;
  userQuery: string;
}

export interface CreateGraphPropsInterface {
  llmModelName: string;
  llmProvider: string;
  voiceId: string;
  graphVisualizationEnabled: boolean;
  connections: ConnectionsMap;
  ttsModelId: string;
  useAssemblyAI?: boolean; // Use Assembly.AI streaming STT (should always be true for audio input)
  assemblyAIApiKey?: string; // Assembly.AI API key (required for audio input)
  useMocks?: boolean; // Use mock components (FakeTTSComponent, FakeRemoteLLMComponent) instead of real ones
}

export interface InteractionInfo {
  sessionId: string;
  interactionId: string;
  text: string;
}
