import { v4 as uuidv4 } from 'uuid';
import * as RT from '../../types/realtime';

/**
 * Factory for creating OpenAI Realtime API server events
 */
export class RealtimeEventFactory {
  /**
   * Create a session.created event
   */
  static sessionCreated(session: RT.Session): RT.SessionCreatedEvent {
    return {
      event_id: uuidv4(),
      type: 'session.created',
      session,
    };
  }

  /**
   * Create a session.updated event
   */
  static sessionUpdated(session: RT.Session): RT.SessionUpdatedEvent {
    return {
      event_id: uuidv4(),
      type: 'session.updated',
      session,
    };
  }

  /**
   * Create a conversation.item.added event
   */
  static conversationItemAdded(
    item: RT.ConversationItem,
    previousItemId: string | null = null,
  ): RT.ConversationItemAddedEvent {
    return {
      event_id: uuidv4(),
      type: 'conversation.item.added',
      previous_item_id: previousItemId,
      item,
    };
  }

  /**
   * Create a conversation.item.done event
   */
  static conversationItemDone(
    item: RT.ConversationItem,
    previousItemId: string | null = null,
  ): RT.ConversationItemDoneEvent {
    return {
      event_id: uuidv4(),
      type: 'conversation.item.done',
      previous_item_id: previousItemId,
      item,
    };
  }

  /**
   * Create a conversation.item.retrieved event
   */
  static conversationItemRetrieved(
    item: RT.ConversationItem,
  ): RT.ConversationItemRetrievedEvent {
    return {
      event_id: uuidv4(),
      type: 'conversation.item.retrieved',
      item,
    };
  }

  /**
   * Create a conversation.item.truncated event
   */
  static conversationItemTruncated(
    itemId: string,
    contentIndex: number,
    audioEndMs: number,
  ): RT.ConversationItemTruncatedEvent {
    return {
      event_id: uuidv4(),
      type: 'conversation.item.truncated',
      item_id: itemId,
      content_index: contentIndex,
      audio_end_ms: audioEndMs,
    };
  }

  /**
   * Create a conversation.item.deleted event
   */
  static conversationItemDeleted(
    itemId: string,
  ): RT.ConversationItemDeletedEvent {
    return {
      event_id: uuidv4(),
      type: 'conversation.item.deleted',
      item_id: itemId,
    };
  }

  /**
   * Create an input_audio_buffer.speech_started event
   */
  static inputAudioBufferSpeechStarted(
    audioStartMs: number,
    itemId: string,
  ): RT.InputAudioBufferSpeechStartedEvent {
    return {
      event_id: uuidv4(),
      type: 'input_audio_buffer.speech_started',
      audio_start_ms: audioStartMs,
      item_id: itemId,
    };
  }

  /**
   * Create an input_audio_buffer.speech_stopped event
   */
  static inputAudioBufferSpeechStopped(
    audioEndMs: number,
    itemId: string,
  ): RT.InputAudioBufferSpeechStoppedEvent {
    return {
      event_id: uuidv4(),
      type: 'input_audio_buffer.speech_stopped',
      audio_end_ms: audioEndMs,
      item_id: itemId,
    };
  }

  /**
   * Create an input_audio_buffer.committed event
   */
  static inputAudioBufferCommitted(
    itemId: string,
    previousItemId: string | null = null,
  ): RT.InputAudioBufferCommittedEvent {
    return {
      event_id: uuidv4(),
      type: 'input_audio_buffer.committed',
      previous_item_id: previousItemId,
      item_id: itemId,
    };
  }

  /**
   * Create an input_audio_buffer.cleared event
   */
  static inputAudioBufferCleared(): RT.InputAudioBufferClearedEvent {
    return {
      event_id: uuidv4(),
      type: 'input_audio_buffer.cleared',
    };
  }

  /**
   * Create a conversation.item.input_audio_transcription.delta event
   */
  static inputAudioTranscriptionDelta(
    itemId: string,
    contentIndex: number,
    delta: string,
  ): RT.ConversationItemInputAudioTranscriptionDeltaEvent {
    return {
      event_id: uuidv4(),
      type: 'conversation.item.input_audio_transcription.delta',
      item_id: itemId,
      content_index: contentIndex,
      delta,
    };
  }

  /**
   * Create a conversation.item.input_audio_transcription.completed event
   */
  static inputAudioTranscriptionCompleted(
    itemId: string,
    contentIndex: number,
    transcript: string,
  ): RT.ConversationItemInputAudioTranscriptionCompletedEvent {
    return {
      event_id: uuidv4(),
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: itemId,
      content_index: contentIndex,
      transcript,
    };
  }

  /**
   * Create a response.created event
   */
  static responseCreated(response: RT.Response): RT.ResponseCreatedEvent {
    return {
      event_id: uuidv4(),
      type: 'response.created',
      response,
    };
  }


  /**
   * Create a response.done event
   */
  static responseDone(response: RT.Response): RT.ResponseDoneEvent {
    return {
      event_id: uuidv4(),
      type: 'response.done',
      response,
    };
  }

  /**
   * Create a response.output_item.added event
   */
  static responseOutputItemAdded(
    responseId: string,
    outputIndex: number,
    item: RT.ConversationItem,
  ): RT.ResponseOutputItemAddedEvent {
    return {
      event_id: uuidv4(),
      type: 'response.output_item.added',
      response_id: responseId,
      output_index: outputIndex,
      item,
    };
  }

  /**
   * Create a response.output_item.done event
   */
  static responseOutputItemDone(
    responseId: string,
    outputIndex: number,
    item: RT.ConversationItem,
  ): RT.ResponseOutputItemDoneEvent {
    return {
      event_id: uuidv4(),
      type: 'response.output_item.done',
      response_id: responseId,
      output_index: outputIndex,
      item,
    };
  }

  /**
   * Create a response.content_part.added event
   */
  static responseContentPartAdded(
    responseId: string,
    itemId: string,
    outputIndex: number,
    contentIndex: number,
    part: RT.ContentPart,
  ): RT.ResponseContentPartAddedEvent {
    return {
      event_id: uuidv4(),
      type: 'response.content_part.added',
      response_id: responseId,
      item_id: itemId,
      output_index: outputIndex,
      content_index: contentIndex,
      part,
    };
  }

  /**
   * Create a response.content_part.done event
   */
  static responseContentPartDone(
    responseId: string,
    itemId: string,
    outputIndex: number,
    contentIndex: number,
    part: RT.ContentPart,
  ): RT.ResponseContentPartDoneEvent {
    return {
      event_id: uuidv4(),
      type: 'response.content_part.done',
      response_id: responseId,
      item_id: itemId,
      output_index: outputIndex,
      content_index: contentIndex,
      part,
    };
  }

  /**
   * Create a response.output_audio.delta event
   */
  static responseAudioDelta(
    responseId: string,
    itemId: string,
    outputIndex: number,
    contentIndex: number,
    delta: string,
  ): RT.ResponseAudioDeltaEvent {
    return {
      event_id: uuidv4(),
      type: 'response.output_audio.delta',
      response_id: responseId,
      item_id: itemId,
      output_index: outputIndex,
      content_index: contentIndex,
      delta,
    };
  }

  /**
   * Create a response.output_audio.done event
   */
  static responseAudioDone(
    responseId: string,
    itemId: string,
    outputIndex: number,
    contentIndex: number,
  ): RT.ResponseAudioDoneEvent {
    return {
      event_id: uuidv4(),
      type: 'response.output_audio.done',
      response_id: responseId,
      item_id: itemId,
      output_index: outputIndex,
      content_index: contentIndex,
    };
  }

  /**
   * Create a response.output_audio_transcript.delta event
   */
  static responseAudioTranscriptDelta(
    responseId: string,
    itemId: string,
    outputIndex: number,
    contentIndex: number,
    delta: string,
  ): RT.ResponseAudioTranscriptDeltaEvent {
    return {
      event_id: uuidv4(),
      type: 'response.output_audio_transcript.delta',
      response_id: responseId,
      item_id: itemId,
      output_index: outputIndex,
      content_index: contentIndex,
      delta,
    };
  }

  /**
   * Create a response.output_audio_transcript.done event
   */
  static responseAudioTranscriptDone(
    responseId: string,
    itemId: string,
    outputIndex: number,
    contentIndex: number,
    transcript: string,
  ): RT.ResponseAudioTranscriptDoneEvent {
    return {
      event_id: uuidv4(),
      type: 'response.output_audio_transcript.done',
      response_id: responseId,
      item_id: itemId,
      output_index: outputIndex,
      content_index: contentIndex,
      transcript,
    };
  }

  /**
   * Create a response.function_call_arguments.delta event
   */
  static responseFunctionCallArgumentsDelta(
    responseId: string,
    itemId: string,
    outputIndex: number,
    callId: string,
    delta: string,
  ): RT.ResponseFunctionCallArgumentsDeltaEvent {
    return {
      event_id: uuidv4(),
      type: 'response.function_call_arguments.delta',
      response_id: responseId,
      item_id: itemId,
      output_index: outputIndex,
      call_id: callId,
      delta,
    };
  }

  /**
   * Create a response.function_call_arguments.done event
   */
  static responseFunctionCallArgumentsDone(
    responseId: string,
    itemId: string,
    outputIndex: number,
    callId: string,
    args: string,
  ): RT.ResponseFunctionCallArgumentsDoneEvent {
    return {
      event_id: uuidv4(),
      type: 'response.function_call_arguments.done',
      response_id: responseId,
      item_id: itemId,
      output_index: outputIndex,
      call_id: callId,
      arguments: args,
    };
  }

  /**
   * Create a response.output_text.delta event
   */
  static responseTextDelta(
    responseId: string,
    itemId: string,
    outputIndex: number,
    contentIndex: number,
    delta: string,
  ): RT.ResponseTextDeltaEvent {
    return {
      event_id: uuidv4(),
      type: 'response.output_text.delta',
      response_id: responseId,
      item_id: itemId,
      output_index: outputIndex,
      content_index: contentIndex,
      delta,
    };
  }

  /**
   * Create a response.output_text.done event
   */
  static responseTextDone(
    responseId: string,
    itemId: string,
    outputIndex: number,
    contentIndex: number,
    text: string,
  ): RT.ResponseTextDoneEvent {
    return {
      event_id: uuidv4(),
      type: 'response.output_text.done',
      response_id: responseId,
      item_id: itemId,
      output_index: outputIndex,
      content_index: contentIndex,
      text,
    };
  }

  /**
   * Create an error event
   */
  static error(
    error: {
      type: string;
      code?: string;
      message: string;
      param?: string;
      event_id?: string;
    },
  ): RT.ErrorEvent {
    return {
      event_id: uuidv4(),
      type: 'error',
      error: {
        type: error.type,
        code: error.code || null,
        message: error.message,
        param: error.param || null,
        event_id: error.event_id || null,
      },
    };
  }

  /**
   * Create a rate_limits.updated event
   */
  static rateLimitsUpdated(
    rateLimits: Array<{
      name: 'requests' | 'tokens';
      limit: number;
      remaining: number;
      reset_seconds: number;
    }>,
  ): RT.RateLimitsUpdatedEvent {
    return {
      event_id: uuidv4(),
      type: 'rate_limits.updated',
      rate_limits: rateLimits,
    };
  }
}
