import { RawData } from 'ws';
import logger from '../../logger';
import { formatContext, formatSession, formatError } from '../../log-helpers';
import * as RT from '../../types/realtime';
import { InworldApp } from '../app';
import { RealtimeEventFactory } from './realtime_event_factory';
import { RealtimeSessionManager } from './realtime_session_manager';
import { RealtimeAudioHandler } from '../audio/realtime_audio_handler';
import { RealtimeGraphExecutor } from '../graphs/realtime_graph_executor';

export class RealtimeMessageHandler {
  private sessionManager: RealtimeSessionManager;
  private audioHandler: RealtimeAudioHandler;
  private graphExecutor: RealtimeGraphExecutor;
  private processingQueue: (() => Promise<void>)[] = [];
  private isProcessing = false;
  private sessionStartTime: number = Date.now();

  constructor(
    private inworldApp: InworldApp,
    private sessionKey: string,
    private send: (data: RT.ServerEvent) => void,
  ) {
    this.sessionManager = new RealtimeSessionManager(inworldApp, sessionKey, send, this.sessionStartTime);
    this.graphExecutor = new RealtimeGraphExecutor(inworldApp, sessionKey, send, this.sessionManager, this.sessionStartTime);
    this.audioHandler = new RealtimeAudioHandler(inworldApp, sessionKey, send, this.graphExecutor, this.sessionManager);
  }

  async initialize(): Promise<void> {
    const connection = this.inworldApp.connections[this.sessionKey];
    if (connection) {
      connection.state.voiceId = this.sessionManager.getSession().session.audio.output.voice;

      connection.onSpeechDetected = (interactionId: string) => {
        logger.info(
          { interactionId, sessionId: this.sessionKey },
          `Speech detected ${formatContext(this.sessionKey, undefined, interactionId)}`
        );

        this.send(RealtimeEventFactory.inputAudioBufferSpeechStarted(
          Date.now() - this.sessionStartTime, // audio_start_ms
          interactionId // item_id
        ));
      };

      // Partial transcript callback
      connection.onPartialTranscript = (text: string, interactionId: string) => {
        this.graphExecutor.handlePartialTranscriptDelta(interactionId, text);
      };
    }

    this.send(RealtimeEventFactory.sessionCreated(this.sessionManager.getSession().session));
  }

  /**
   * Handle incoming WebSocket messages
   */
  async handleMessage(data: RawData): Promise<void> {
    try {
      const event = JSON.parse(data.toString()) as RT.ClientEvent;

      // Handle these events immediately without queuing:

      // 1. Cancellation - needs to stop ongoing response generation immediately
      if (event.type === 'response.cancel') {
        logger.info({
          sessionId: this.sessionKey,
          responseId: event.response_id,
        }, `Cancelling response with id: ${event.response_id}`);
        this.graphExecutor.cancelCurrentResponse('client_cancelled');
        return;
      }

      // 2. Audio append - needs to flow continuously without blocking
      if (event.type === 'input_audio_buffer.append') {
        await this.audioHandler.handleInputAudioBufferAppend(event);
        return;
      }

      // Add all other events to the queue to ensure sequential processing
      this.addToQueue(async () => {
        try {
          switch (event.type) {
            case 'session.update':
              await this.sessionManager.updateSession(event);
              break;

            case 'input_audio_buffer.commit':
              await this.audioHandler.handleInputAudioBufferCommit(event);
              break;

            case 'input_audio_buffer.clear':
              await this.audioHandler.handleInputAudioBufferClear(event);
              break;

            case 'conversation.item.create':
              await this.sessionManager.createConversationItem(event, this.audioHandler);
              break;

            case 'conversation.item.truncate':
              await this.sessionManager.truncateConversationItem(event);
              break;

            case 'conversation.item.delete':
              await this.sessionManager.deleteConversationItem(event);
              break;

            case 'conversation.item.retrieve':
              await this.sessionManager.retrieveConversationItem(event);
              break;

            case 'response.create':
              await this.graphExecutor.createResponse();
              break;

            default:
              logger.warn({ eventType: (event as any).type, sessionId: this.sessionKey }, `Unknown event type: ${(event as any).type}`);
          }
        } catch (error) {
          logger.error({ err: error, sessionId: this.sessionKey }, 'Error handling queued message');
          this.send(
            RealtimeEventFactory.error({
              type: 'invalid_request_error',
              message: error.message,
            }),
          );
        }
      });
    } catch (error) {
      logger.error({ err: error, sessionId: this.sessionKey }, 'Error parsing message');
      this.send(
        RealtimeEventFactory.error({
          type: 'invalid_request_error',
          message: 'Failed to parse message',
        }),
      );
    }
  }

  /**
   * Add task to processing queue
   */
  private addToQueue(task: () => Promise<void>): void {
    this.processingQueue.push(task);
    this.processQueue();
  }

  /**
   * Process queued tasks
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing) {
      return;
    }
    this.isProcessing = true;
    while (this.processingQueue.length > 0) {
      const task = this.processingQueue.shift();
      if (task) {
        try {
          await task();
        } catch (error) {
          logger.error({ err: error, sessionId: this.sessionKey }, 'Error processing task from queue');
        }
      }
    }
    this.isProcessing = false;
  }
}
