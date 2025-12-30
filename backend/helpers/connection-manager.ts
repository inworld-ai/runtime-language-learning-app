/**
 * ConnectionManager - Manages WebSocket connections and graph execution
 *
 * This replaces the AudioProcessor for Inworld Runtime 0.9.
 * Key differences from AudioProcessor:
 * - Uses MultimodalStreamManager to feed audio to a long-running graph
 * - VAD is handled inside the graph by AssemblyAI (not external Silero)
 * - Graph runs continuously for the session duration
 */

import { WebSocket } from 'ws';
import { GraphTypes } from '@inworld/runtime/graph';

import { ConversationGraphWrapper } from '../graphs/conversation-graph.js';
import { MultimodalStreamManager } from './multimodal_stream_manager.js';
import { decodeBase64ToFloat32, debugAddAudioChunk, debugLogAudioStats, debugSaveAudio } from './audio_utils.js';
import { ConnectionsMap, INPUT_SAMPLE_RATE, TTS_SAMPLE_RATE } from '../types/index.js';
import {
  getLanguageConfig,
  DEFAULT_LANGUAGE_CODE,
  LanguageConfig,
} from '../config/languages.js';
import type { IntroductionState } from './introduction-state-processor.js';

export class ConnectionManager {
  private sessionId: string;
  private ws: WebSocket;
  private graphWrapper: ConversationGraphWrapper;
  private multimodalStreamManager: MultimodalStreamManager;
  private connections: ConnectionsMap;
  private graphExecution: Promise<void> | null = null;
  private isDestroyed = false;
  private languageCode: string;
  private languageConfig: LanguageConfig;

  // Callbacks for flashcard and introduction state processing
  private flashcardCallback:
    | ((messages: Array<{ role: string; content: string }>) => Promise<void>)
    | null = null;
  private introductionStateCallback:
    | ((
        messages: Array<{ role: string; content: string }>
      ) => Promise<IntroductionState | null>)
    | null = null;

  constructor(
    sessionId: string,
    ws: WebSocket,
    graphWrapper: ConversationGraphWrapper,
    connections: ConnectionsMap,
    languageCode: string = DEFAULT_LANGUAGE_CODE
  ) {
    this.sessionId = sessionId;
    this.ws = ws;
    this.graphWrapper = graphWrapper;
    this.connections = connections;
    this.languageCode = languageCode;
    this.languageConfig = getLanguageConfig(languageCode);
    this.multimodalStreamManager = new MultimodalStreamManager();

    // Initialize connection state
    this.connections[sessionId] = {
      ws: ws,
      state: {
        interactionId: '',
        messages: [],
        userName: '',
        targetLanguage: this.languageConfig.name,
        languageCode: languageCode,
        voiceId: this.languageConfig.ttsConfig.speakerId,
        introductionState: { name: '', level: '', goal: '', timestamp: '' },
        output_modalities: ['audio', 'text'],
      },
      multimodalStreamManager: this.multimodalStreamManager,
      onSpeechDetected: (interactionId) =>
        this.handleSpeechDetected(interactionId),
      onPartialTranscript: (text, interactionId) =>
        this.handlePartialTranscript(text, interactionId),
    };

    console.log(
      `[ConnectionManager] Created for session ${sessionId} with language ${this.languageConfig.name}`
    );
  }

  /**
   * Start the long-running graph execution
   */
  async start(): Promise<void> {
    console.log(`[ConnectionManager] Starting graph for session ${this.sessionId}`);

    // Create the multimodal stream generator
    const multimodalStream = this.createMultimodalStreamGenerator();

    // Start graph execution (runs in background)
    this.graphExecution = this.executeGraph(multimodalStream);

    // Don't await - the graph runs continuously
    this.graphExecution.catch((error) => {
      if (!this.isDestroyed) {
        console.error(`[ConnectionManager] Graph execution error:`, error);
      }
    });
  }

  /**
   * Create an async generator that yields multimodal content from the stream manager
   */
  private async *createMultimodalStreamGenerator(): AsyncGenerator<GraphTypes.MultimodalContent> {
    for await (const content of this.multimodalStreamManager.createStream()) {
      yield content;
    }
  }

  /**
   * Execute the graph with the multimodal stream
   */
  private async executeGraph(
    stream: AsyncGenerator<GraphTypes.MultimodalContent>
  ): Promise<void> {
    const connection = this.connections[this.sessionId];
    if (!connection) {
      throw new Error(`No connection found for session ${this.sessionId}`);
    }

    // Tag the stream for the runtime
    const taggedStream = Object.assign(stream, {
      type: 'MultimodalContent',
    });

    console.log(`[ConnectionManager] Starting graph execution for ${this.sessionId}`);

    const { outputStream } = await this.graphWrapper.graph.start(taggedStream, {
      executionId: this.sessionId,
      dataStoreContent: {
        sessionId: this.sessionId,
        state: connection.state,
      },
      userContext: {
        attributes: {
          languageCode: this.languageCode,
          language: this.languageConfig.name,
        },
        targetingKey: this.sessionId,
      },
    });

    // Store the output stream for potential cancellation
    connection.currentAudioExecutionStream = outputStream;

    // Process graph outputs
    try {
      for await (const result of outputStream) {
        if (this.isDestroyed) break;
        await this.processGraphOutput(result);
      }
    } catch (error) {
      if (!this.isDestroyed) {
        console.error(`[ConnectionManager] Error processing output:`, error);
      }
    } finally {
      connection.currentAudioExecutionStream = undefined;
    }

    console.log(`[ConnectionManager] Graph execution completed for ${this.sessionId}`);
  }

  /**
   * Process a single output from the graph
   */
  private async processGraphOutput(result: unknown): Promise<void> {
    const connection = this.connections[this.sessionId];
    if (!connection) return;

    let transcription = '';
    let llmResponse = '';

    try {
      // Cast to any to work around strict typing issues with processResponse handlers
      // The handlers receive typed data at runtime even though the type system says unknown
      const resultWithProcess = result as { processResponse: (handlers: Record<string, (data: unknown) => Promise<void> | void>) => Promise<void> };
      await resultWithProcess.processResponse({
        // Handle string output (transcription from proxy node)
        string: (data: unknown) => {
          transcription = String(data);
          if (transcription.trim()) {
            console.log(`[ConnectionManager] Transcription: "${transcription}"`);
            this.sendToClient({
              type: 'transcription',
              text: transcription.trim(),
              timestamp: Date.now(),
            });

            // Trigger introduction state extraction
            this.triggerIntroductionStateExtraction();
          }
        },

        // Handle Custom data (transcription from transcript extractor)
        // InteractionInfo has: sessionId, interactionId, text, interactionComplete
        Custom: async (customData: unknown) => {
          const data = customData as { text?: string; interactionId?: string; interactionComplete?: boolean };
          // Only send final transcriptions (interactionComplete=true) to avoid duplicates
          if (data.text && data.interactionComplete) {
            transcription = data.text;
            console.log(`[ConnectionManager] Transcription (final): "${transcription}"`);
            this.sendToClient({
              type: 'transcription',
              text: transcription.trim(),
              timestamp: Date.now(),
            });
            this.triggerIntroductionStateExtraction();
          }
        },

        // Handle LLM response stream
        ContentStream: async (streamData: unknown) => {
          const stream = streamData as GraphTypes.ContentStream;
          console.log('[ConnectionManager] Processing LLM ContentStream...');
          let currentResponse = '';

          for await (const chunk of stream) {
            if (this.isDestroyed) break;
            if (chunk.text) {
              currentResponse += chunk.text;
              this.sendToClient({
                type: 'llm_response_chunk',
                text: chunk.text,
                timestamp: Date.now(),
              });
            }
          }

          if (currentResponse.trim()) {
            llmResponse = currentResponse;
            console.log(
              `[ConnectionManager] LLM Response complete: "${llmResponse.substring(0, 50)}..."`
            );
            this.sendToClient({
              type: 'llm_response_complete',
              text: llmResponse.trim(),
              timestamp: Date.now(),
            });
          }
        },

        // Handle TTS output stream
        TTSOutputStream: async (ttsData: unknown) => {
          const ttsStream = ttsData as GraphTypes.TTSOutputStream;
          console.log('[ConnectionManager] Processing TTS stream...');
          let isFirstChunk = true;

          for await (const chunk of ttsStream) {
            if (this.isDestroyed) break;
            if (chunk.audio?.data) {
              // Log sample rate on first chunk
              if (isFirstChunk) {
                console.log(`[ConnectionManager] TTS audio: sampleRate=${chunk.audio.sampleRate || TTS_SAMPLE_RATE}, bytes=${Array.isArray(chunk.audio.data) ? chunk.audio.data.length : 'N/A'}`);
              }

              // Convert audio to base64 for WebSocket transmission
              // Use TTS_SAMPLE_RATE as fallback (not INPUT_SAMPLE_RATE which is for microphone input)
              const audioResult = this.convertAudioToBase64(chunk.audio);
              if (audioResult) {
                this.sendToClient({
                  type: 'audio_stream',
                  audio: audioResult.base64,
                  audioFormat: audioResult.format,
                  sampleRate: chunk.audio.sampleRate || TTS_SAMPLE_RATE,
                  text: chunk.text || '',
                  isFirstChunk: isFirstChunk,
                  timestamp: Date.now(),
                });
                isFirstChunk = false;
              }
            }
          }

          // Send completion signal
          console.log('[ConnectionManager] TTS stream complete');
          this.sendToClient({
            type: 'audio_stream_complete',
            timestamp: Date.now(),
          });

          // Send conversation update
          this.sendToClient({
            type: 'conversation_update',
            messages: connection.state.messages,
            timestamp: Date.now(),
          });

          // Trigger flashcard generation after TTS completes
          this.triggerFlashcardGeneration();
        },

        // Handle errors
        error: async (error: unknown) => {
          const err = error as { message?: string };
          console.error('[ConnectionManager] Graph error:', err);
          if (!err.message?.includes('recognition produced no text')) {
            this.sendToClient({
              type: 'error',
              message: err.message || 'Unknown error',
              timestamp: Date.now(),
            });
          }
        },

        // Default handler for unknown types
        default: (_data: unknown) => {
          // console.log('[ConnectionManager] Unknown output type:', data);
        },
      });
    } catch (error) {
      console.error('[ConnectionManager] Error processing graph output:', error);
    }
  }

  /**
   * Add an audio chunk from the WebSocket
   */
  addAudioChunk(base64Audio: string): void {
    if (this.isDestroyed) return;

    try {
      // Decode base64 to Float32Array
      const float32Data = decodeBase64ToFloat32(base64Audio);

      // Debug: log audio stats and collect for WAV export
      debugLogAudioStats(this.sessionId, float32Data);
      debugAddAudioChunk(this.sessionId, float32Data);

      // Push to multimodal stream
      this.multimodalStreamManager.pushAudio({
        data: Array.from(float32Data),
        sampleRate: INPUT_SAMPLE_RATE,
      });
    } catch (error) {
      console.error('[ConnectionManager] Error adding audio chunk:', error);
    }
  }

  /**
   * Handle speech detected event from AssemblyAI
   */
  private handleSpeechDetected(interactionId: string): void {
    console.log(`[ConnectionManager] Speech detected: ${interactionId}`);
    this.sendToClient({
      type: 'speech_detected',
      interactionId,
      data: { text: '' },
      timestamp: Date.now(),
    });

    // Could also send interrupt signal here if needed
    this.sendToClient({
      type: 'interrupt',
      reason: 'speech_start',
    });
  }

  /**
   * Handle partial transcript from AssemblyAI
   */
  private handlePartialTranscript(text: string, interactionId: string): void {
    this.sendToClient({
      type: 'partial_transcript',
      text,
      interactionId,
      timestamp: Date.now(),
    });
  }

  /**
   * Convert audio data to base64 string for WebSocket transmission
   * Inworld TTS returns Float32 PCM in [-1.0, 1.0] range - send directly to preserve quality
   */
  private convertAudioToBase64(audio: {
    data?: string | number[] | Float32Array;
    sampleRate?: number;
  }): { base64: string; format: 'float32' | 'int16' } | null {
    if (!audio.data) return null;

    if (typeof audio.data === 'string') {
      // Already base64 - assume Int16 format for backwards compatibility
      return { base64: audio.data, format: 'int16' };
    }

    // Inworld SDK returns audio.data as an array of raw bytes (0-255)
    // These bytes ARE the Float32 PCM data in IEEE 754 format (4 bytes per sample)
    // Simply pass them through as-is, and frontend interprets as Float32Array
    const audioBuffer = Array.isArray(audio.data)
      ? Buffer.from(audio.data)  // Treat each array element as a byte
      : Buffer.from(audio.data.buffer, audio.data.byteOffset, audio.data.byteLength);

    return {
      base64: audioBuffer.toString('base64'),
      format: 'float32',  // Frontend will interpret bytes as Float32Array
    };
  }

  /**
   * Send message to WebSocket client
   */
  private sendToClient(message: Record<string, unknown>): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(message));
      } catch (error) {
        console.error('[ConnectionManager] Error sending to client:', error);
      }
    }
  }

  /**
   * Trigger flashcard generation
   */
  private triggerFlashcardGeneration(): void {
    if (!this.flashcardCallback) return;

    const connection = this.connections[this.sessionId];
    if (!connection) return;

    const recentMessages = connection.state.messages.slice(-6).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    this.flashcardCallback(recentMessages).catch((error) => {
      console.error('[ConnectionManager] Flashcard generation error:', error);
    });
  }

  /**
   * Trigger introduction state extraction
   */
  private triggerIntroductionStateExtraction(): void {
    if (!this.introductionStateCallback) return;

    const connection = this.connections[this.sessionId];
    if (!connection) return;

    // Skip if introduction is already complete
    const intro = connection.state.introductionState;
    if (intro.name && intro.level && intro.goal) {
      return;
    }

    const recentMessages = connection.state.messages.slice(-6).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    this.introductionStateCallback(recentMessages)
      .then((state) => {
        if (state) {
          connection.state.introductionState = state;
          this.sendToClient({
            type: 'introduction_state_updated',
            introduction_state: state,
            timestamp: Date.now(),
          });
        }
      })
      .catch((error) => {
        console.error('[ConnectionManager] Introduction state error:', error);
      });
  }

  // ============================================================
  // Public API (compatible with AudioProcessor)
  // ============================================================

  setFlashcardCallback(
    callback: (
      messages: Array<{ role: string; content: string }>
    ) => Promise<void>
  ): void {
    this.flashcardCallback = callback;
  }

  setIntroductionStateCallback(
    callback: (
      messages: Array<{ role: string; content: string }>
    ) => Promise<IntroductionState | null>
  ): void {
    this.introductionStateCallback = callback;
  }

  getConversationState(): { messages: Array<{ role: string; content: string; timestamp: string }> } {
    const connection = this.connections[this.sessionId];
    return {
      messages:
        connection?.state.messages.map((m) => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp || new Date().toISOString(),
        })) || [],
    };
  }

  getIntroductionState(): IntroductionState {
    const connection = this.connections[this.sessionId];
    return (
      connection?.state.introductionState || {
        name: '',
        level: '',
        goal: '',
        timestamp: '',
      }
    );
  }

  getLanguageCode(): string {
    return this.languageCode;
  }

  getLanguageConfig(): LanguageConfig {
    return this.languageConfig;
  }

  /**
   * Change language for this session
   */
  setLanguage(newLanguageCode: string): void {
    if (this.languageCode === newLanguageCode) return;

    console.log(
      `[ConnectionManager] Changing language from ${this.languageCode} to ${newLanguageCode}`
    );

    this.languageCode = newLanguageCode;
    this.languageConfig = getLanguageConfig(newLanguageCode);

    const connection = this.connections[this.sessionId];
    if (connection) {
      connection.state.languageCode = newLanguageCode;
      connection.state.targetLanguage = this.languageConfig.name;
      connection.state.voiceId = this.languageConfig.ttsConfig.speakerId;
    }

    console.log(
      `[ConnectionManager] Language changed to ${this.languageConfig.name}`
    );
  }

  /**
   * Reset conversation state
   */
  reset(): void {
    const connection = this.connections[this.sessionId];
    if (connection) {
      connection.state.messages = [];
      connection.state.introductionState = {
        name: '',
        level: '',
        goal: '',
        timestamp: '',
      };
      connection.state.interactionId = '';
    }
    console.log('[ConnectionManager] Conversation reset');
  }

  /**
   * Clean up resources
   */
  async destroy(): Promise<void> {
    console.log(`[ConnectionManager] Destroying session ${this.sessionId}`);
    this.isDestroyed = true;

    // Save debug audio if enabled (DEBUG_AUDIO=true)
    debugSaveAudio(this.sessionId, INPUT_SAMPLE_RATE);

    // End the multimodal stream
    this.multimodalStreamManager.end();

    // Close AssemblyAI session
    await this.graphWrapper.assemblyAINode.closeSession(this.sessionId);

    // Remove from connections map
    delete this.connections[this.sessionId];

    console.log(`[ConnectionManager] Session ${this.sessionId} destroyed`);
  }
}
