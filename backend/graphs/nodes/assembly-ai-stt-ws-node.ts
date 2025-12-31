import { DataStreamWithMetadata } from '@inworld/runtime';
import { CustomNode, GraphTypes, ProcessContext } from '@inworld/runtime/graph';
import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';

import { Connection } from '../../types/index.js';
import { audioDataToPCM16 } from '../../helpers/audio-utils.js';

/**
 * Configuration interface for AssemblyAISTTWebSocketNode
 */
export interface AssemblyAISTTWebSocketNodeConfig {
  /** Assembly.AI API key */
  apiKey: string;
  /** Connections map to access session state */
  connections: { [sessionId: string]: Connection };
  /** Sample rate of the audio stream in Hz */
  sampleRate?: number;
  /** Enable turn formatting from Assembly.AI */
  formatTurns?: boolean;
  /** End of turn confidence threshold (0-1) */
  endOfTurnConfidenceThreshold?: number;
  /** Minimum silence duration when confident (in milliseconds) */
  minEndOfTurnSilenceWhenConfident?: number;
  /** Maximum turn silence (in milliseconds) */
  maxTurnSilence?: number;
}

/**
 * Manages a persistent WebSocket connection to Assembly.AI for a single session.
 */
class AssemblyAISession {
  private ws: WebSocket | null = null;
  private wsReady: boolean = false;
  private wsConnectionPromise: Promise<void> | null = null;

  public assemblySessionId: string = '';
  public sessionExpiresAt: number = 0;
  public shouldStopProcessing: boolean = false;

  private inactivityTimeout: NodeJS.Timeout | null = null;
  private lastActivityTime: number = Date.now();
  private readonly INACTIVITY_TIMEOUT_MS = 60000; // 60 seconds

  constructor(
    public readonly sessionId: string,
    private apiKey: string,
    private url: string,
    private onCleanup: (sessionId: string) => void
  ) {}

  /**
   * Ensure WebSocket connection is ready, reconnecting if needed
   */
  public async ensureConnection(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const isExpired = this.sessionExpiresAt > 0 && now >= this.sessionExpiresAt;

    if (
      !this.ws ||
      !this.wsReady ||
      this.ws.readyState !== WebSocket.OPEN ||
      isExpired
    ) {
      if (isExpired) {
        console.log(`[AssemblyAI] Session ${this.sessionId} expired, reconnecting`);
      }
      this.closeWebSocket();
      this.initializeWebSocket();
    }

    if (this.wsConnectionPromise) {
      await this.wsConnectionPromise;
    }

    this.shouldStopProcessing = false;
    this.resetInactivityTimer();
  }

  private initializeWebSocket(): void {
    console.log(`[AssemblyAI] Initializing WebSocket for session ${this.sessionId}`);

    this.wsConnectionPromise = new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(this.url, {
        headers: { Authorization: this.apiKey },
      });

      this.ws.on('open', () => {
        console.log(`[AssemblyAI] WebSocket opened for session ${this.sessionId}`);
        this.wsReady = true;
        resolve();
      });

      // Permanent message handler for session metadata
      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'Begin') {
            this.assemblySessionId = message.id || message.session_id || '';
            this.sessionExpiresAt = message.expires_at || 0;
            console.log(`[AssemblyAI] Session began: ${this.assemblySessionId}`);
          }
        } catch {
          // Ignore parsing errors
        }
      });

      this.ws.on('error', (error: Error) => {
        console.error(`[AssemblyAI] WebSocket error:`, error);
        this.wsReady = false;
        reject(error);
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        console.log(`[AssemblyAI] WebSocket closed [code:${code}] [reason:${reason.toString()}]`);
        this.wsReady = false;
      });
    });
  }

  public onMessage(listener: (data: WebSocket.Data) => void): void {
    if (this.ws) {
      this.ws.on('message', listener);
    }
  }

  public offMessage(listener: (data: WebSocket.Data) => void): void {
    if (this.ws) {
      this.ws.off('message', listener);
    }
  }

  public sendAudio(pcm16Data: Int16Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(Buffer.from(pcm16Data.buffer));
      this.resetInactivityTimer();
    }
  }

  private resetInactivityTimer(): void {
    if (this.inactivityTimeout) {
      clearTimeout(this.inactivityTimeout);
    }
    this.lastActivityTime = Date.now();
    this.inactivityTimeout = setTimeout(() => {
      this.closeDueToInactivity();
    }, this.INACTIVITY_TIMEOUT_MS);
  }

  private closeDueToInactivity(): void {
    const inactiveFor = Date.now() - this.lastActivityTime;
    console.log(`[AssemblyAI] Closing session ${this.sessionId} due to inactivity (${inactiveFor}ms)`);
    this.shouldStopProcessing = true;
    this.close();
    this.onCleanup(this.sessionId);
  }

  private closeWebSocket(): void {
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.close();
        }
      } catch (e) {
        console.warn('[AssemblyAI] Error closing socket:', e);
      }
      this.ws = null;
      this.wsReady = false;
    }
  }

  public async close(): Promise<void> {
    if (this.inactivityTimeout) {
      clearTimeout(this.inactivityTimeout);
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: 'Terminate' }));
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch {
        // Ignore
      }
    }

    this.closeWebSocket();
  }
}

/**
 * AssemblyAISTTWebSocketNode processes continuous multimodal streams using Assembly.AI's
 * streaming Speech-to-Text service via direct WebSocket connection.
 *
 * This node:
 * - Receives MultimodalContent stream (audio and/or text)
 * - For audio: extracts audio and feeds to Assembly.AI streaming transcriber
 * - For text: bypasses STT and returns text directly
 * - Detects turn endings using Assembly.AI's neural turn detection
 * - Returns DataStreamWithMetadata with transcribed text when a turn completes
 */
export class AssemblyAISTTWebSocketNode extends CustomNode {
  private apiKey: string;
  private connections: { [sessionId: string]: Connection };
  private sampleRate: number;
  private formatTurns: boolean;
  private endOfTurnConfidenceThreshold: number;
  private minEndOfTurnSilenceWhenConfident: number;
  private maxTurnSilence: number;
  private wsEndpointBaseUrl: string = 'wss://streaming.assemblyai.com/v3/ws';

  private sessions: Map<string, AssemblyAISession> = new Map();
  private readonly TURN_COMPLETION_TIMEOUT_MS = 2000;
  private readonly MAX_TRANSCRIPTION_DURATION_MS = 40000;

  constructor(props: { id?: string; config: AssemblyAISTTWebSocketNodeConfig }) {
    const { config, ...nodeProps } = props;

    if (!config.apiKey) {
      throw new Error('AssemblyAISTTWebSocketNode requires an API key.');
    }
    if (!config.connections) {
      throw new Error('AssemblyAISTTWebSocketNode requires a connections object.');
    }

    super({ id: nodeProps.id || 'assembly-ai-stt-ws-node' });

    this.apiKey = config.apiKey;
    this.connections = config.connections;
    this.sampleRate = config.sampleRate || 16000;
    this.formatTurns = config.formatTurns ?? false;
    this.endOfTurnConfidenceThreshold = config.endOfTurnConfidenceThreshold ?? 0.7;
    this.minEndOfTurnSilenceWhenConfident = config.minEndOfTurnSilenceWhenConfident ?? 800;
    this.maxTurnSilence = config.maxTurnSilence ?? 3600;

    console.log(
      `[AssemblyAI] Configured [threshold:${this.endOfTurnConfidenceThreshold}] [minSilence:${this.minEndOfTurnSilenceWhenConfident}ms] [maxSilence:${this.maxTurnSilence}ms]`
    );
  }

  /**
   * Build WebSocket URL with query parameters
   */
  private buildWebSocketUrl(): string {
    const params = new URLSearchParams({
      sample_rate: this.sampleRate.toString(),
      encoding: 'pcm_s16le',
      format_turns: this.formatTurns.toString(),
      end_of_turn_confidence_threshold: this.endOfTurnConfidenceThreshold.toString(),
      min_end_of_turn_silence_when_confident: this.minEndOfTurnSilenceWhenConfident.toString(),
      max_turn_silence: this.maxTurnSilence.toString(),
      speech_model: 'universal-streaming-multilingual',
      language_detection: 'true',
    });

    const url = `${this.wsEndpointBaseUrl}?${params.toString()}`;
    console.log(
      `[AssemblyAI] Connecting [model:universal-streaming-multilingual] [threshold:${this.endOfTurnConfidenceThreshold}] [maxSilence:${this.maxTurnSilence}ms]`
    );

    return url;
  }

  /**
   * Process multimodal stream and transcribe using Assembly.AI WebSocket
   */
  async process(
    context: ProcessContext,
    input0: AsyncIterableIterator<GraphTypes.MultimodalContent>,
    input: DataStreamWithMetadata
  ): Promise<DataStreamWithMetadata> {
    const multimodalStream =
      input !== undefined &&
      input !== null &&
      input instanceof DataStreamWithMetadata
        ? (input.toStream() as unknown as AsyncIterableIterator<GraphTypes.MultimodalContent>)
        : input0;

    const sessionId = context.getDatastore().get('sessionId') as string;
    const connection = this.connections[sessionId];

    if (connection?.unloaded) {
      throw Error(`Session unloaded for sessionId: ${sessionId}`);
    }
    if (!connection) {
      throw Error(`Failed to read connection for sessionId: ${sessionId}`);
    }

    // Get iteration from metadata or parse from interactionId
    const metadata = input?.getMetadata?.() || {};
    let previousIteration = (metadata.iteration as number) || 0;

    if (!connection.state.interactionId || connection.state.interactionId === '') {
      connection.state.interactionId = uuidv4();
    }

    const currentId = connection.state.interactionId;
    const delimiterIndex = currentId.indexOf('#');

    if (previousIteration === 0 && delimiterIndex !== -1) {
      const iterationStr = currentId.substring(delimiterIndex + 1);
      const parsedIteration = parseInt(iterationStr, 10);
      if (!isNaN(parsedIteration) && /^\d+$/.test(iterationStr)) {
        previousIteration = parsedIteration;
      }
    }

    const iteration = previousIteration + 1;
    const baseId = delimiterIndex !== -1 ? currentId.substring(0, delimiterIndex) : currentId;
    const nextInteractionId = `${baseId}#${iteration}`;

    console.log(`[AssemblyAI] Starting transcription [iteration:${iteration}]`);

    // State tracking
    let transcriptText = '';
    let turnDetected = false;
    let speechDetected = false;
    let audioChunkCount = 0;
    let totalAudioSamples = 0;
    let isStreamExhausted = false;
    let errorOccurred = false;
    let errorMessage = '';
    let maxDurationReached = false;
    let isTextInput = false;
    let textContent: string | undefined;

    // Get or create session
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = new AssemblyAISession(
        sessionId,
        this.apiKey,
        this.buildWebSocketUrl(),
        (id) => this.sessions.delete(id)
      );
      this.sessions.set(sessionId, session);
    }

    // Promise to capture turn result
    let turnResolve: (value: string) => void = () => {};
    let turnReject: (error: Error) => void = () => {};
    let turnCompleted = false;
    const turnPromise = new Promise<string>((resolve, reject) => {
      turnResolve = resolve;
      turnReject = reject;
    });
    const turnPromiseWithState = turnPromise.then((value) => {
      turnCompleted = true;
      return value;
    });

    // AssemblyAI message handler for this process() call
    const messageHandler = (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString());
        const msgType = message.type;

        if (msgType === 'Turn') {
          if (session?.shouldStopProcessing) {
            return;
          }

          const transcript = message.transcript || '';
          const utterance = message.utterance || '';
          const isFinal = message.end_of_turn;

          if (!transcript) return;

          if (!isFinal) {
            // Partial transcript
            const textToSend = utterance || transcript;
            if (textToSend) {
              this.sendPartialTranscript(sessionId, nextInteractionId, textToSend);

              if (connection?.onSpeechDetected && !speechDetected) {
                console.log(`[AssemblyAI] Speech detected [iteration:${iteration}]`);
                speechDetected = true;
                connection.onSpeechDetected(nextInteractionId);
              }
            }
            return;
          }

          // Final transcript - check for pending transcript to stitch
          let finalTranscript = transcript;

          if (connection?.pendingTranscript) {
            // Stitch the pending transcript with the new one
            finalTranscript = `${connection.pendingTranscript} ${transcript}`.trim();
            console.log(`[AssemblyAI] Stitched transcript [iteration:${iteration}]: "${finalTranscript.substring(0, 80)}..."`);
            // Clear the pending transcript
            connection.pendingTranscript = undefined;
          } else {
            console.log(`[AssemblyAI] Turn detected [iteration:${iteration}]: "${transcript.substring(0, 50)}..."`);
          }

          // Clear interrupt flag for new processing
          if (connection) {
            connection.isProcessingInterrupted = false;
          }

          transcriptText = finalTranscript;
          turnDetected = true;
          if (session) session.shouldStopProcessing = true;
          turnResolve(finalTranscript);

        } else if (msgType === 'Termination') {
          console.log(`[AssemblyAI] Session terminated [iteration:${iteration}]`);
        }
      } catch (error) {
        console.error(`[AssemblyAI] Error handling message:`, error);
      }
    };

    try {
      await session.ensureConnection();
      session.onMessage(messageHandler);

      // Process multimodal content (audio chunks)
      const audioProcessingPromise = (async () => {
        let maxDurationTimeout: NodeJS.Timeout | null = null;
        try {
          // Safety timer: prevent infinite loops
          maxDurationTimeout = setTimeout(() => {
            maxDurationReached = true;
          }, this.MAX_TRANSCRIPTION_DURATION_MS);

          while (true) {
            if (session?.shouldStopProcessing) break;

            if (maxDurationReached && !transcriptText) {
              console.warn(`[AssemblyAI] Max transcription duration reached [${this.MAX_TRANSCRIPTION_DURATION_MS}ms]`);
              break;
            }

            const result = await multimodalStream.next();

            if (result.done) {
              console.log(`[AssemblyAI] Multimodal stream exhausted [iteration:${iteration}] [chunks:${audioChunkCount}]`);
              isStreamExhausted = true;
              break;
            }

            if (session?.shouldStopProcessing) break;

            const content = result.value as GraphTypes.MultimodalContent;

            // Handle text input
            if (content.text !== undefined && content.text !== null) {
              console.log(`[AssemblyAI] Text input detected [iteration:${iteration}]: "${content.text.substring(0, 50)}..."`);
              isTextInput = true;
              textContent = content.text;
              transcriptText = content.text;
              turnDetected = true;
              if (session) session.shouldStopProcessing = true;
              turnResolve(transcriptText);
              break;
            }

            // Extract audio
            if (content.audio === undefined || content.audio === null) continue;

            const audioData = content.audio.data;
            if (!audioData || audioData.length === 0) continue;

            audioChunkCount++;
            totalAudioSamples += audioData.length;

            const pcm16Data = audioDataToPCM16(audioData);
            session?.sendAudio(pcm16Data);
          }
        } catch (error) {
          console.error(`[AssemblyAI] Error processing audio:`, error);
          errorOccurred = true;
          errorMessage = error instanceof Error ? error.message : String(error);
          throw error;
        } finally {
          if (maxDurationTimeout) {
            clearTimeout(maxDurationTimeout);
          }
        }
      })();

      const raceResult = await Promise.race([
        turnPromiseWithState.then(() => ({ winner: 'turn' as const })),
        audioProcessingPromise.then(() => ({ winner: 'audio' as const })),
      ]);

      if (raceResult.winner === 'audio' && !turnCompleted && !maxDurationReached) {
        console.log(`[AssemblyAI] Audio ended before turn, waiting ${this.TURN_COMPLETION_TIMEOUT_MS}ms`);

        // Send silence to keep connection alive - AssemblyAI needs continuous audio
        const silenceIntervalMs = 100;
        const silenceSamples = Math.floor((silenceIntervalMs / 1000) * this.sampleRate);
        const silenceFrame = new Int16Array(silenceSamples);
        const silenceTimer = setInterval(() => {
          if (session && !session.shouldStopProcessing) {
            session.sendAudio(silenceFrame);
          }
        }, silenceIntervalMs);

        const timeoutPromise = new Promise<{ winner: 'timeout' }>((resolve) =>
          setTimeout(() => resolve({ winner: 'timeout' }), this.TURN_COMPLETION_TIMEOUT_MS)
        );

        const waitResult = await Promise.race([
          turnPromiseWithState.then(() => ({ winner: 'turn' as const })),
          timeoutPromise,
        ]);

        clearInterval(silenceTimer);

        if (waitResult.winner === 'timeout' && !turnCompleted) {
          console.warn(`[AssemblyAI] Timed out waiting for turn`);
          turnReject?.(new Error('Timed out waiting for turn completion'));
        }
      }

      await audioProcessingPromise.catch(() => {});

      console.log(`[AssemblyAI] Transcription complete [iteration:${iteration}]: "${transcriptText?.substring(0, 50)}..."`);

      if (turnDetected) {
        connection.state.interactionId = '';
      }

      const taggedStream = Object.assign(multimodalStream, {
        type: 'MultimodalContent',
        abort: () => {},
        getMetadata: () => ({}),
      });

      return new DataStreamWithMetadata(taggedStream, {
        elementType: 'MultimodalContent',
        iteration: iteration,
        interactionId: nextInteractionId,
        session_id: sessionId,
        assembly_session_id: session.assemblySessionId,
        transcript: transcriptText,
        turn_detected: turnDetected,
        audio_chunk_count: audioChunkCount,
        total_audio_samples: totalAudioSamples,
        sample_rate: this.sampleRate,
        stream_exhausted: isStreamExhausted,
        interaction_complete: turnDetected && transcriptText.length > 0,
        error_occurred: errorOccurred,
        error_message: errorMessage,
        is_text_input: isTextInput,
        text_content: textContent,
      });
    } catch (error) {
      console.error(`[AssemblyAI] Transcription failed [iteration:${iteration}]:`, error);

      const taggedStream = Object.assign(multimodalStream, {
        type: 'MultimodalContent',
        abort: () => {},
        getMetadata: () => ({}),
      });

      return new DataStreamWithMetadata(taggedStream, {
        elementType: 'MultimodalContent',
        iteration: iteration,
        interactionId: nextInteractionId,
        session_id: sessionId,
        transcript: '',
        turn_detected: false,
        stream_exhausted: isStreamExhausted,
        interaction_complete: false,
        error_occurred: true,
        error_message: error instanceof Error ? error.message : String(error),
        is_text_input: isTextInput,
        text_content: textContent,
      });
    } finally {
      if (session) {
        session.offMessage(messageHandler);
      }
    }
  }

  private sendPartialTranscript(sessionId: string, interactionId: string, text: string): void {
    const connection = this.connections[sessionId];
    if (!connection?.onPartialTranscript) return;

    try {
      connection.onPartialTranscript(text, interactionId);
    } catch (error) {
      console.error('[AssemblyAI] Error sending partial transcript:', error);
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      console.log(`[AssemblyAI] Closing session: ${sessionId}`);
      await session.close();
      this.sessions.delete(sessionId);
    }
  }

  async destroy(): Promise<void> {
    console.log(`[AssemblyAI] Destroying node: closing ${this.sessions.size} sessions`);

    const promises: Promise<void>[] = [];
    for (const session of this.sessions.values()) {
      promises.push(session.close());
    }

    await Promise.all(promises);
    this.sessions.clear();
  }
}

