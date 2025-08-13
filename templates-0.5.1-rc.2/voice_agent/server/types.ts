import { AudioChunkInterface } from '@inworld/runtime/common';

export enum EVENT_TYPE {
  TEXT = 'text',
  AUDIO = 'audio',
  AUDIO_SESSION_END = 'audioSessionEnd',
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
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  motivation: string;
  knowledge?: string[];
}

export interface TextInput {
  key: string;
  text: string;
  interactionId: string;
}

export interface AudioInput {
  key: string;
  audio: AudioChunkInterface;
  state: State;
  interactionId: string;
}

export interface State {
  agent: Agent;
  userName: string;
  messages: ChatMessage[];
}

export interface Connection {
  state: State;
  ws: any;
}

export interface PromptInput {
  agent: Agent;
  messages: ChatMessage[];
  userName: string;
  userQuery: string;
}

export interface CreateGraphPropsInterface {
  apiKey: string;
  llmModelName: string;
  llmProvider: string;
  voiceId: string;
  graphVisualizationEnabled: boolean;
  connections: {
    [key: string]: Connection;
  };
  withAudioInput?: boolean;
  ttsModelId: string;
}
