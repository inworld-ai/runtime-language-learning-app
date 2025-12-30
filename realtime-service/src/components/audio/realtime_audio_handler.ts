import logger from '../../logger';
import { formatSession, formatError } from '../../log-helpers';
import { INPUT_SAMPLE_RATE } from '../../config';
import * as RT from '../../types/realtime';
import { InworldApp } from '../app';
import { MultimodalStreamManager } from './multimodal_stream_manager';
import { RealtimeEventFactory } from '../realtime/realtime_event_factory';
import { RealtimeGraphExecutor } from '../graphs/realtime_graph_executor';
import { RealtimeSessionManager } from '../realtime/realtime_session_manager';

export class RealtimeAudioHandler {
  constructor(
    private inworldApp: InworldApp,
    private sessionKey: string,
    private send: (data: RT.ServerEvent) => void,
    private graphExecutor: RealtimeGraphExecutor,
    private sessionManager: RealtimeSessionManager
  ) {}

  /**
   * Ensures that the audio graph execution is running.
   * Creates the multimodal stream manager and starts the graph execution if not already running.
   * @param connection - The connection object to initialize
   * @param context - Context string for logging (e.g., 'Audio', 'Text Input')
   */
  private ensureAudioGraphExecution(
    connection: NonNullable<typeof this.inworldApp.connections[string]>,
    context: string = 'Audio'
  ): void {
    if (connection.multimodalStreamManager) {
      return;
    }

    connection.multimodalStreamManager = new MultimodalStreamManager();

    const session = this.sessionManager.getSession();

    // Start the audio graph execution with the stream
    const audioStreamInput = {
      sessionId: this.sessionKey,
      state: connection.state,
      voiceId: connection.state.voiceId || session.session.audio.output.voice,
    };

    // Use the Assembly.AI audio graph
    const graphWrapper = this.inworldApp.graphWithAudioInput;

    // Start graph execution in the background - it will consume from the stream
    connection.currentAudioGraphExecution =
      this.graphExecutor.executeAudioGraph({
        sessionId: this.sessionKey,
        workspaceId: connection.workspaceId,
        apiKey: connection.apiKey,
        input: audioStreamInput,
        graphWrapper,
        multimodalStreamManager: connection.multimodalStreamManager,
      }).catch((error) => {
        logger.error({ err: error, sessionId: this.sessionKey }, `${context} - Error in audio graph execution`);
        // Clean up on error
        if (connection.multimodalStreamManager) {
          connection.multimodalStreamManager.end();
          connection.multimodalStreamManager = undefined;
        }
        connection.currentAudioGraphExecution = undefined;
        // Send error to websocket
        this.send(
          RealtimeEventFactory.error({
            type: 'server_error',
            message: error instanceof Error ? error.message : 'Error in audio graph execution',
          }),
        );
      });
  }

  /**
   * Handle input_audio_buffer.append event
   * Stream audio directly to Inworld SDK 0.8 audio graph
   */
  async handleInputAudioBufferAppend(
    event: RT.InputAudioBufferAppendEvent,
  ): Promise<void> {
    const connection = this.inworldApp.connections[this.sessionKey];
    if (!connection) {
      logger.error({ sessionId: this.sessionKey }, 'Audio - No connection found');
      return;
    }

    // Decode base64 audio (PCM16 at 24kHz from OpenAI)
    const audioBuffer = Buffer.from(event.audio, 'base64');
    const int16Array = new Int16Array(
      audioBuffer.buffer,
      audioBuffer.byteOffset,
      audioBuffer.length / 2,
    );

    // Convert PCM16 Int16 to Float32 for Inworld graph (normalize to -1.0 to 1.0)
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0;
    }

    // Downsample from 24kHz to 16kHz (2:3 ratio)
    // For every 3 samples at 24kHz, we output 2 samples at 16kHz
    const targetLength = Math.floor(float32Array.length * 2 / 3);
    const resampled = new Float32Array(targetLength);
    
    for (let i = 0; i < targetLength; i++) {
      const sourceIndex = i * 1.5; // 24kHz/16kHz = 1.5
      const index0 = Math.floor(sourceIndex);
      const index1 = Math.min(index0 + 1, float32Array.length - 1);
      const frac = sourceIndex - index0;
      
      // Linear interpolation
      resampled[i] = float32Array[index0] * (1 - frac) + float32Array[index1] * frac;
    }

    // Convert to number array for MultimodalStreamManager
    const audioData = Array.from(resampled);

    // Ensure the audio graph execution is running
    this.ensureAudioGraphExecution(connection, 'Audio');

    // Push the audio chunk to the stream (already resampled to 16kHz)
    connection.multimodalStreamManager!.pushAudio({
      data: audioData,
      sampleRate: INPUT_SAMPLE_RATE, // 16kHz for Inworld graph
    });
  }

  /**
   * Handle input_audio_buffer.commit event
   * End the audio stream and wait for graph to complete
   */
  async handleInputAudioBufferCommit(
    event: RT.InputAudioBufferCommitEvent,
  ): Promise<void> {
    const connection = this.inworldApp.connections[this.sessionKey];
    if (!connection) {
      this.send(
        RealtimeEventFactory.error({
          type: 'invalid_request_error',
          message: 'No connection found',
          event_id: event.event_id,
        }),
      );
      return;
    }

    if (!connection.multimodalStreamManager) {
      this.send(
        RealtimeEventFactory.error({
          type: 'invalid_request_error',
          message: 'No active audio stream',
          event_id: event.event_id,
        }),
      );
      return;
    }

    logger.info({ sessionId: this.sessionKey }, `Commit - Manual commit requested - ending audio stream [${this.sessionKey}]`);
    connection.multimodalStreamManager.end();

    // Wait for the graph execution to complete
    if (connection.currentAudioGraphExecution) {
      await connection.currentAudioGraphExecution;
    }

    // Clear the buffer
    this.sessionManager.getSession().inputAudioBuffer = [];
  }

  /**
   * Handle input_audio_buffer.clear event
   */
  async handleInputAudioBufferClear(
    event: RT.InputAudioBufferClearEvent,
  ): Promise<void> {
    const connection = this.inworldApp.connections[this.sessionKey];
    if (connection?.multimodalStreamManager) {
      connection.multimodalStreamManager.end();
      connection.multimodalStreamManager = undefined;
      connection.currentAudioGraphExecution = undefined;
    }

    this.sessionManager.getSession().inputAudioBuffer = [];
    this.send(RealtimeEventFactory.inputAudioBufferCleared());
  }

  /**
   * Handle text input by pushing it to the multimodal stream manager
   * This unifies text and audio inputs through the same audio graph
   */
  async handleTextInput(text: string): Promise<void> {
    const connection = this.inworldApp.connections[this.sessionKey];
    if (!connection) {
      logger.error({ sessionId: this.sessionKey }, 'Text Input - No connection found');
      return;
    }

    logger.info({ sessionId: this.sessionKey, text: text.substring(0, 100) }, `Text Input - Pushing text to audio graph: "${text.substring(0, 50)}..."`);

    // Ensure the audio graph execution is running
    this.ensureAudioGraphExecution(connection, 'Text Input');

    // Push the text to the stream
    connection.multimodalStreamManager!.pushText(text);

    // Don't wait for completion here - let the graph run in the background
    // The graph will automatically create a response when it processes the text
    // The response.create event will wait for completion if needed
  }
}

