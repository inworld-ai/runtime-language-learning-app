/**
 * OpenAI Realtime API Type Definitions
 * Based on the OpenAI Realtime API specification
 */

import { GraphTypes } from '@inworld/runtime/graph';

// ============================================================================
// Client Events (sent from client to server)
// ============================================================================

export interface ClientEventBase {
  event_id?: string;
}

export interface SessionUpdateEvent extends ClientEventBase {
  type: 'session.update';
  session: Partial<SessionConfig>;
}

export interface InputAudioBufferAppendEvent extends ClientEventBase {
  type: 'input_audio_buffer.append';
  audio: string; // base64-encoded audio
}

export interface InputAudioBufferCommitEvent extends ClientEventBase {
  type: 'input_audio_buffer.commit';
}

export interface InputAudioBufferClearEvent extends ClientEventBase {
  type: 'input_audio_buffer.clear';
}

export interface ConversationItemCreateEvent extends ClientEventBase {
  type: 'conversation.item.create';
  previous_item_id?: string;
  item: ConversationItem;
}

export interface ConversationItemTruncateEvent extends ClientEventBase {
  type: 'conversation.item.truncate';
  item_id: string;
  content_index: number;
  audio_end_ms: number;
}

export interface ConversationItemDeleteEvent extends ClientEventBase {
  type: 'conversation.item.delete';
  item_id: string;
}

export interface ConversationItemRetrieveEvent extends ClientEventBase {
  type: 'conversation.item.retrieve';
  item_id: string;
}

export interface ResponseCreateEvent extends ClientEventBase {
  type: 'response.create';
  response?: ResponseConfig;
}

export interface ResponseCancelEvent extends ClientEventBase {
  type: 'response.cancel';
  response_id?: string;
}

export type ClientEvent =
  | SessionUpdateEvent
  | InputAudioBufferAppendEvent
  | InputAudioBufferCommitEvent
  | InputAudioBufferClearEvent
  | ConversationItemCreateEvent
  | ConversationItemTruncateEvent
  | ConversationItemDeleteEvent
  | ConversationItemRetrieveEvent
  | ResponseCreateEvent
  | ResponseCancelEvent;

// ============================================================================
// Server Events (sent from server to client)
// ============================================================================

export interface ServerEventBase {
  event_id: string;
}

export interface SessionCreatedEvent extends ServerEventBase {
  type: 'session.created';
  session: Session;
}

export interface SessionUpdatedEvent extends ServerEventBase {
  type: 'session.updated';
  session: Session;
}

export interface ConversationItemAddedEvent extends ServerEventBase {
  type: 'conversation.item.added';
  previous_item_id: string | null;
  item: ConversationItem;
}

export interface ConversationItemDoneEvent extends ServerEventBase {
  type: 'conversation.item.done';
  previous_item_id: string | null;
  item: ConversationItem;
}

export interface ConversationItemRetrievedEvent extends ServerEventBase {
  type: 'conversation.item.retrieved';
  item: ConversationItem;
}

export interface ConversationItemTruncatedEvent extends ServerEventBase {
  type: 'conversation.item.truncated';
  item_id: string;
  content_index: number;
  audio_end_ms: number;
}

export interface ConversationItemDeletedEvent extends ServerEventBase {
  type: 'conversation.item.deleted';
  item_id: string;
}

export interface InputAudioBufferCommittedEvent extends ServerEventBase {
  type: 'input_audio_buffer.committed';
  previous_item_id: string | null;
  item_id: string;
}

export interface InputAudioBufferClearedEvent extends ServerEventBase {
  type: 'input_audio_buffer.cleared';
}

export interface InputAudioBufferSpeechStartedEvent extends ServerEventBase {
  type: 'input_audio_buffer.speech_started';
  audio_start_ms: number;
  item_id: string;
}

export interface InputAudioBufferSpeechStoppedEvent extends ServerEventBase {
  type: 'input_audio_buffer.speech_stopped';
  audio_end_ms: number;
  item_id: string;
}

export interface ConversationItemInputAudioTranscriptionDeltaEvent
  extends ServerEventBase {
  type: 'conversation.item.input_audio_transcription.delta';
  item_id: string;
  content_index: number;
  delta: string;
}

export interface ConversationItemInputAudioTranscriptionCompletedEvent
  extends ServerEventBase {
  type: 'conversation.item.input_audio_transcription.completed';
  item_id: string;
  content_index: number;
  transcript: string;
}

export interface ResponseCreatedEvent extends ServerEventBase {
  type: 'response.created';
  response: Response;
}


export interface ResponseDoneEvent extends ServerEventBase {
  type: 'response.done';
  response: Response;
}

export interface ResponseOutputItemAddedEvent extends ServerEventBase {
  type: 'response.output_item.added';
  response_id: string;
  output_index: number;
  item: ConversationItem;
}

export interface ResponseOutputItemDoneEvent extends ServerEventBase {
  type: 'response.output_item.done';
  response_id: string;
  output_index: number;
  item: ConversationItem;
}

export interface ResponseContentPartAddedEvent extends ServerEventBase {
  type: 'response.content_part.added';
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  part: ContentPart;
}

export interface ResponseContentPartDoneEvent extends ServerEventBase {
  type: 'response.content_part.done';
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  part: ContentPart;
}

export interface ResponseAudioDeltaEvent extends ServerEventBase {
  type: 'response.output_audio.delta';
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  delta: string; // base64-encoded audio
}

export interface ResponseAudioDoneEvent extends ServerEventBase {
  type: 'response.output_audio.done';
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
}

export interface ResponseAudioTranscriptDeltaEvent extends ServerEventBase {
  type: 'response.output_audio_transcript.delta';
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  delta: string;
}

export interface ResponseAudioTranscriptDoneEvent extends ServerEventBase {
  type: 'response.output_audio_transcript.done';
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  transcript: string;
}

export interface ResponseFunctionCallArgumentsDeltaEvent extends ServerEventBase {
  type: 'response.function_call_arguments.delta';
  response_id: string;
  item_id: string;
  output_index: number;
  call_id: string;
  delta: string;
}

export interface ResponseFunctionCallArgumentsDoneEvent extends ServerEventBase {
  type: 'response.function_call_arguments.done';
  response_id: string;
  item_id: string;
  output_index: number;
  call_id: string;
  arguments: string;
}

export interface ResponseTextDeltaEvent extends ServerEventBase {
  type: 'response.output_text.delta';
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  delta: string;
}

export interface ResponseTextDoneEvent extends ServerEventBase {
  type: 'response.output_text.done';
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  text: string;
}

export interface ErrorEvent extends ServerEventBase {
  type: 'error';
  error: {
    type: string;
    code: string | null;
    message: string;
    param: string | null;
    event_id: string | null;
  };
}

export interface RateLimitsUpdatedEvent extends ServerEventBase {
  type: 'rate_limits.updated';
  rate_limits: Array<{
    name: 'requests' | 'tokens';
    limit: number;
    remaining: number;
    reset_seconds: number;
  }>;
}

export type ServerEvent =
  | SessionCreatedEvent
  | SessionUpdatedEvent
  | ConversationItemAddedEvent
  | ConversationItemDoneEvent
  | ConversationItemRetrievedEvent
  | ConversationItemTruncatedEvent
  | ConversationItemDeletedEvent
  | InputAudioBufferCommittedEvent
  | InputAudioBufferClearedEvent
  | InputAudioBufferSpeechStartedEvent
  | InputAudioBufferSpeechStoppedEvent
  | ConversationItemInputAudioTranscriptionDeltaEvent
  | ConversationItemInputAudioTranscriptionCompletedEvent
  | ResponseCreatedEvent
  | ResponseDoneEvent
  | ResponseOutputItemAddedEvent
  | ResponseOutputItemDoneEvent
  | ResponseContentPartAddedEvent
  | ResponseContentPartDoneEvent
  | ResponseAudioDeltaEvent
  | ResponseAudioDoneEvent
  | ResponseAudioTranscriptDeltaEvent
  | ResponseAudioTranscriptDoneEvent
  | ResponseFunctionCallArgumentsDeltaEvent
  | ResponseFunctionCallArgumentsDoneEvent
  | ResponseTextDeltaEvent
  | ResponseTextDoneEvent
  | ErrorEvent
  | RateLimitsUpdatedEvent;

// ============================================================================
// Data Types
// ============================================================================

export interface AudioInputConfig {
  format: {
    type: 'audio/pcm';
    rate: 24000;
  };
  transcription?: {
    model: string;
    language?: string;
  } | null;
  noise_reduction?: {
    type: 'near_field' | 'far_field';
  } | null;
  turn_detection?: TurnDetection | null;
}

export interface AudioOutputConfig {
  format: {
    type: 'audio/pcm';
    rate: 24000;
  };
  voice: string;
  speed?: number;
}

export interface SessionConfig {
  output_modalities?: ('text' | 'audio')[];
  instructions?: string;
  audio?: {
    input?: Partial<AudioInputConfig>;
    output?: Partial<AudioOutputConfig>;
  };
  tools?: Tool[];
  tool_choice?: 'auto' | 'none' | 'required';
  temperature?: number;
  max_output_tokens?: number | 'inf';
  truncation?: 'auto' | 'disabled';
  prompt?: string | null;
  tracing?: string | null;
  include?: string[] | null;
}

export interface Session {
  type: 'realtime';
  id: string;
  object: 'realtime.session';
  model: string;
  output_modalities: ('text' | 'audio')[];
  instructions: string;
  audio: {
    input: AudioInputConfig;
    output: AudioOutputConfig;
  };
  tools: Tool[];
  tool_choice: 'auto' | 'none' | 'required';
  temperature: number;
  max_output_tokens: number | 'inf';
  truncation: 'auto' | 'disabled';
  prompt: string | null;
  tracing: string | null;
  expires_at: number;
  include: string[] | null;
}

// Turn detection can be either server_vad (simple) or semantic_vad (advanced with eagerness)
export interface ServerVADTurnDetection {
  type: 'server_vad';
  threshold?: number;
  prefix_padding_ms?: number;
  silence_duration_ms?: number;
  idle_timeout_ms?: number | null;
  create_response?: boolean;
  interrupt_response?: boolean;
}

export interface SemanticVADTurnDetection {
  type: 'semantic_vad';
  eagerness?: 'low' | 'medium' | 'high' | 'auto';
  create_response?: boolean;
  interrupt_response?: boolean;
}

export type TurnDetection = ServerVADTurnDetection | SemanticVADTurnDetection;

export interface Tool {
  type: 'function';
  name: string;
  description?: string;
  parameters?: Record<string, any>;
}

export interface ConversationItem {
  id?: string;
  type: 'message' | 'function_call' | 'function_call_output';
  object?: 'realtime.item';
  status?: 'completed' | 'in_progress' | 'incomplete';
  role?: 'user' | 'assistant' | 'system';
  content?: ContentPart[];
  call_id?: string;
  name?: string;
  arguments?: string;
  output?: string;
}

// Specific types for different conversation items
export interface MessageItem extends ConversationItem {
  type: 'message';
  role: 'user' | 'assistant' | 'system';
  content: ContentPart[];
}

export interface FunctionCallItem extends ConversationItem {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
}

export interface FunctionCallOutputItem extends ConversationItem {
  type: 'function_call_output';
  call_id: string;
  output: string;
}

export interface ContentPart {
  type: 'text' | 'audio' | 'input_text' | 'input_audio';
  text?: string;
  audio?: string; // base64-encoded
  transcript?: string;
}

export interface ResponseConfig {
  modalities?: ('text' | 'audio')[];
  instructions?: string;
  voice?: string;
  output_audio_format?: 'pcm16' | 'g711_ulaw' | 'g711_alaw';
  tools?: Tool[];
  tool_choice?: 'auto' | 'none' | 'required';
  temperature?: number;
  max_output_tokens?: number | 'inf';
}

export interface Response {
  id: string;
  object: 'realtime.response';
  status: 'in_progress' | 'completed' | 'cancelled' | 'failed' | 'incomplete';
  status_details?: {
    type: 'completed' | 'cancelled' | 'incomplete' | 'failed';
    reason?: string;
    error?: {
      type: string;
      code?: string;
    };
  } | null;
  output: ConversationItem[];
  conversation_id?: string | null;
  output_modalities?: ('text' | 'audio')[];
  max_output_tokens?: number | 'inf';
  audio?: {
    output: AudioOutputConfig;
  };
  usage?: {
    total_tokens: number;
    input_tokens: number;
    output_tokens: number;
    input_token_details?: {
      cached_tokens?: number;
      text_tokens?: number;
      image_tokens?: number;
      audio_tokens?: number;
    };
    output_token_details?: {
      text_tokens?: number;
      audio_tokens?: number;
    };
  } | null;
  metadata?: any | null;
}

// ============================================================================
// Session State
// ============================================================================

export interface RealtimeSession {
  id: string;
  session: Session;
  conversationItems: ConversationItem[];
  inputAudioBuffer: number[];
  currentResponse: Response | null;
  audioStartMs: number;
  // Store active streams so they can be aborted on cancel
  currentContentStream?: GraphTypes.ContentStream | null;
  currentTTSStream?: GraphTypes.TTSOutputStream | null;
}
