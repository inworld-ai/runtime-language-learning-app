import { DataStreamWithMetadata } from '@inworld/runtime';
import { CustomNode, GraphTypes, ProcessContext } from '@inworld/runtime/graph';
import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';

import { Connection } from '../../../types/index';
import { getAssemblyAISettingsForEagerness } from '../../../types/settings';
import logger from '../../../logger';
import { formatSession, formatContext, formatError } from '../../../log-helpers';
import { float32ToPCM16 } from '../../audio/audio_utils';

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
  /** Language code (e.g., 'en', 'es') */
  language?: string;
  /** Keywords/keyterms to boost recognition */
  keytermsPrompt?: string[];
}

/**
 * Manages a persistent WebSocket connection to Assembly.AI for a single session.
 * Encapsulates connection lifecycle, inactivity timeouts, and message sending.
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
    // Check if connection is expired
    const now = Math.floor(Date.now() / 1000);
    const isExpired = this.sessionExpiresAt > 0 && now >= this.sessionExpiresAt;

    if (
      !this.ws ||
      !this.wsReady ||
      this.ws.readyState !== WebSocket.OPEN ||
      isExpired
    ) {
      if (isExpired) {
        logger.info({ sessionId: this.sessionId }, 'AssemblyAI session expired, reconnecting');
      } else if (this.ws) {
        logger.info({ sessionId: this.sessionId, readyState: this.ws.readyState }, `AssemblyAI connection not ready [state:${this.ws.readyState}], reconnecting`);
      } else {
        logger.info({ sessionId: this.sessionId }, 'AssemblyAI connecting');
      }

      // Close existing connection if any
      this.closeWebSocket();

      // Start new connection
      this.initializeWebSocket();
    }

    if (this.wsConnectionPromise) {
      await this.wsConnectionPromise;
    }

    // Reset flags
    this.shouldStopProcessing = false;
    this.resetInactivityTimer();
  }

  /**
   * Initialize the WebSocket connection
   */
  private initializeWebSocket(): void {
    logger.info({ sessionId: this.sessionId }, 'AssemblyAI initializing WebSocket');

    this.wsConnectionPromise = new Promise<void>((resolve, reject) => {
      logger.info({ sessionId: this.sessionId, url: this.url }, 'AssemblyAI WS STT - Connecting');

      this.ws = new WebSocket(this.url, {
        headers: { Authorization: this.apiKey },
      });

      this.ws.on('open', () => {
        logger.info({ sessionId: this.sessionId }, `AssemblyAI WebSocket opened ${formatSession(this.sessionId)}`);
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
            logger.info({
              sessionId: this.sessionId,
              assemblySessionId: this.assemblySessionId,
              expiresAt: this.sessionExpiresAt ? new Date(this.sessionExpiresAt * 1000).toISOString() : 'unknown',
            }, `AssemblyAI session began ${formatSession(this.sessionId)} [assembly:${this.assemblySessionId}]`);
          }
        } catch (error) {
          // Ignore parsing errors here, they might be handled by other listeners
        }
      });

      this.ws.on('error', (error: Error) => {
        logger.error({ err: error, sessionId: this.sessionId }, 'AssemblyAI WebSocket error');
        this.wsReady = false;
        reject(error);
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        logger.info({
          sessionId: this.sessionId,
          code,
          reason: reason.toString(),
        }, `AssemblyAI WebSocket closed ${formatSession(this.sessionId)} [code:${code}] [reason:${reason.toString()}]`);
        this.wsReady = false;
      });
    });
  }

  /**
   * Add a message listener
   */
  public onMessage(listener: (data: WebSocket.Data) => void): void {
    if (this.ws) {
      this.ws.on('message', listener);
    }
  }

  /**
   * Remove a message listener
   */
  public offMessage(listener: (data: WebSocket.Data) => void): void {
    if (this.ws) {
      this.ws.off('message', listener);
    }
  }

  /**
   * Send audio data
   */
  public sendAudio(pcm16Data: Int16Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(Buffer.from(pcm16Data.buffer));
      this.resetInactivityTimer();
    } else {
      logger.warn({ sessionId: this.sessionId }, 'AssemblyAI WebSocket not open, skipping audio chunk');
    }
  }

  /**
   * Update turn detection configuration on the active WebSocket connection
   */
  public updateConfiguration(config: {
    endOfTurnConfidenceThreshold?: number;
    minEndOfTurnSilenceWhenConfident?: number;
    maxTurnSilence?: number;
  }): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const updateMessage: any = {
        type: 'UpdateConfiguration',
      };

      if (config.endOfTurnConfidenceThreshold !== undefined) {
        updateMessage.end_of_turn_confidence_threshold = config.endOfTurnConfidenceThreshold;
      }
      if (config.minEndOfTurnSilenceWhenConfident !== undefined) {
        updateMessage.min_end_of_turn_silence_when_confident = config.minEndOfTurnSilenceWhenConfident;
      }
      if (config.maxTurnSilence !== undefined) {
        updateMessage.max_turn_silence = config.maxTurnSilence;
      }

      this.ws.send(JSON.stringify(updateMessage));
      logger.info({ sessionId: this.sessionId, config: updateMessage }, `AssemblyAI configuration updated ${formatSession(this.sessionId)}`);
    } else {
      logger.warn({ sessionId: this.sessionId }, 'AssemblyAI cannot update config: WebSocket not open');
    }
  }


  /**
   * Reset the inactivity timer
   */
  private resetInactivityTimer(): void {
    if (this.inactivityTimeout) {
      clearTimeout(this.inactivityTimeout);
    }

    this.lastActivityTime = Date.now();
    this.inactivityTimeout = setTimeout(() => {
      this.closeDueToInactivity();
    }, this.INACTIVITY_TIMEOUT_MS);
  }

  /**
   * Close connection due to inactivity
   */
  private closeDueToInactivity(): void {
    const inactiveFor = Date.now() - this.lastActivityTime;
    logger.info({ sessionId: this.sessionId, inactiveFor }, `AssemblyAI closing due to inactivity ${formatSession(this.sessionId)} [inactive:${inactiveFor}ms]`);

    this.shouldStopProcessing = true;
    this.close();
    this.onCleanup(this.sessionId);
  }

  /**
   * Close the WebSocket connection
   */
  private closeWebSocket(): void {
    if (this.ws) {
      try {
        // Remove all listeners to prevent leaks
        this.ws.removeAllListeners();
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.close();
        }
      } catch (e) {
        logger.warn({ err: e, sessionId: this.sessionId }, 'AssemblyAI error closing socket');
      }
      this.ws = null;
      this.wsReady = false;
    }
  }

  /**
   * Gracefully close the session
   */
  public async close(): Promise<void> {
    if (this.inactivityTimeout) {
      clearTimeout(this.inactivityTimeout);
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: 'Terminate' }));
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (e) {
        // Ignore error on send
      }
    }

    this.closeWebSocket();
  }
}

/**
 * AssemblyAISTTWebSocketNode processes continuous multimodal streams (audio and/or text) using Assembly.AI's
 * streaming Speech-to-Text service via direct WebSocket connection.
 *
 * This node:
 * - Receives MultimodalContent stream (audio and/or text)
 * - For audio: extracts audio from MultimodalContent and feeds to Assembly.AI streaming transcriber
 * - For text: skips processing (text input should bypass STT)
 * - Connects directly to Assembly.AI WebSocket endpoint
 * - Detects turn endings automatically using Assembly.AI's turn detection
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
  private language: string;
  private keytermsPrompt: string[];
  private wsEndpointBaseUrl: string = 'wss://streaming.assemblyai.com/v3/ws';

  private sessions: Map<string, AssemblyAISession> = new Map();
  private readonly TURN_COMPLETION_TIMEOUT_MS = 2000;
  private readonly MAX_TRANSCRIPTION_DURATION_MS = 40000;

  constructor(props: {
    id?: string;
    config: AssemblyAISTTWebSocketNodeConfig;
  }) {
    const { config, ...nodeProps } = props;

    if (!config.apiKey) {
      throw new Error('AssemblyAISTTWebSocketNode requires an API key.');
    }

    if (!config.connections) {
      throw new Error(
        'AssemblyAISTTWebSocketNode requires a connections object.',
      );
    }

    super({
      id: nodeProps.id || 'assembly-ai-stt-ws-node',
      executionConfig: {
        sampleRate: config.sampleRate || 16000,
        formatTurns: config.formatTurns !== false,
        endOfTurnConfidenceThreshold:
          config.endOfTurnConfidenceThreshold || 0.4,
        minEndOfTurnSilenceWhenConfident:
          config.minEndOfTurnSilenceWhenConfident || 400,
        maxTurnSilence: config.maxTurnSilence || 1280,
        language: config.language || 'en',
      },
    });

    this.apiKey = config.apiKey;
    this.connections = config.connections;
    this.sampleRate = config.sampleRate || 16000;
    this.formatTurns = config.formatTurns !== false;
    this.endOfTurnConfidenceThreshold =
      config.endOfTurnConfidenceThreshold || 0.4;
    this.minEndOfTurnSilenceWhenConfident =
      config.minEndOfTurnSilenceWhenConfident || 400;
    this.maxTurnSilence = config.maxTurnSilence || 1280;
    this.language = config.language || 'en';
    this.keytermsPrompt = config.keytermsPrompt || [];

    // Log the turn detection settings being used
    logger.info({
      endOfTurnConfidenceThreshold: this.endOfTurnConfidenceThreshold,
      minEndOfTurnSilenceWhenConfident: this.minEndOfTurnSilenceWhenConfident,
      maxTurnSilence: this.maxTurnSilence,
      sampleRate: this.sampleRate,
      formatTurns: this.formatTurns,
      language: this.language,
    }, `AssemblyAI configured [threshold:${this.endOfTurnConfidenceThreshold}] [silence:${this.minEndOfTurnSilenceWhenConfident}ms] [lang:${this.language}]`);
  }

  /**
   * Build WebSocket URL with query parameters
   * Dynamically uses connection.state.eagerness if available
   */
  private buildWebSocketUrl(sessionId?: string): string {
    // Get current settings - check connection state for eagerness updates
    let endOfTurnThreshold = this.endOfTurnConfidenceThreshold;
    let minSilenceWhenConfident = this.minEndOfTurnSilenceWhenConfident;
    let maxSilence = this.maxTurnSilence;

    if (sessionId) {
      const connection = this.connections[sessionId];
      const eagerness = connection?.state?.eagerness;

      if (eagerness) {
        // Map eagerness to settings dynamically using shared settings function
        const settings = getAssemblyAISettingsForEagerness(eagerness);
        endOfTurnThreshold = settings.endOfTurnConfidenceThreshold;
        minSilenceWhenConfident = settings.minEndOfTurnSilenceWhenConfident;
        maxSilence = settings.maxTurnSilence;

        logger.info({ sessionId, eagerness }, `AssemblyAI using eagerness settings: ${eagerness}`);
      }
    }

    const params = new URLSearchParams({
      sample_rate: this.sampleRate.toString(),
      format_turns: this.formatTurns.toString(),
      end_of_turn_confidence_threshold: endOfTurnThreshold.toString(),
      min_end_of_turn_silence_when_confident: minSilenceWhenConfident.toString(),
      max_turn_silence: maxSilence.toString(),
      language: this.language,
    });

    // Add keyterms if provided
    if (this.keytermsPrompt.length > 0) {
      this.keytermsPrompt.forEach((term) => {
        params.append('keyterms_prompt', term);
      });
    }

    const url = `${this.wsEndpointBaseUrl}?${params.toString()}`;

    logger.info({
      sessionId,
      endOfTurnConfidenceThreshold: endOfTurnThreshold,
      minEndOfTurnSilenceWhenConfident: minSilenceWhenConfident,
      maxTurnSilence: maxSilence,
    }, `AssemblyAI connecting ${formatSession(sessionId)} [threshold:${endOfTurnThreshold}] [silence:${minSilenceWhenConfident}ms]`);

    return url;
  }


  /**
   * Process multimodal stream (audio and/or text) and transcribe using Assembly.AI WebSocket
   * For audio: extracts audio from MultimodalContent and sends to Assembly.AI
   * For text: currently not handled (text input should bypass STT)
   */
  async process(
    context: ProcessContext,
    input0: AsyncIterableIterator<GraphTypes.MultimodalContent>,
    input: DataStreamWithMetadata,
  ): Promise<DataStreamWithMetadata> {
    // Extract MultimodalContent stream from either input type
    const multimodalStream =
      input !== undefined &&
      input !== null &&
      input instanceof DataStreamWithMetadata
        ? (input.toStream() as any as AsyncIterableIterator<GraphTypes.MultimodalContent>)
        : input0;

    const sessionId = context.getDatastore().get('sessionId') as string;
    const connection = this.connections[sessionId];

    // Check connection exists before accessing its properties
    if (connection?.unloaded) {
      throw Error(`Session unloaded for sessionId: ${sessionId}`);
    }
    if (!connection) {
      throw Error(`Failed to read connection for sessionId: ${sessionId}`);
    }

    // Get iteration number from metadata, or parse from interactionId
    const metadata = input?.getMetadata?.() || {};
    let previousIteration = (metadata.iteration as number) || 0;

    // If interactionId is empty, assign a UUID
    if (!connection.state.interactionId || connection.state.interactionId === '') {
      connection.state.interactionId = uuidv4();
      logger.info({ sessionId, interactionId: connection.state.interactionId }, 'AssemblyAI assigned new UUID for empty interactionId');
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
    const baseId =
      delimiterIndex !== -1
        ? currentId.substring(0, delimiterIndex)
        : currentId;
    const nextInteractionId = `${baseId}#${iteration}`;

    logger.info({ sessionId, iteration }, `AssemblyAI starting transcription [iteration:${iteration}]`);

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
    // For text modality input
    let isTextInput = false;
    let textContent: string | undefined;

    // Get or create session
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = new AssemblyAISession(
        sessionId,
        this.apiKey,
        this.buildWebSocketUrl(sessionId), // Pass sessionId to get dynamic eagerness settings
        (id) => this.sessions.delete(id)
      );
      this.sessions.set(sessionId, session);
    }

    // Promise to capture the turn result
    let turnResolve: (value: string) => void;
    let turnReject: (error: any) => void;
    let turnCompleted = false;
    const turnPromise = new Promise<string>((resolve, reject) => {
      turnResolve = resolve;
      turnReject = reject;
    });
    const turnPromiseWithState = turnPromise.then((value) => {
      turnCompleted = true;
      return value;
    });

    // Assembly AI Callback handler
    const messageHandler = (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString());
        const msgType = message.type;

        if (msgType === 'Turn') {
          // Ignore turn events if we've already decided to stop
          if (session?.shouldStopProcessing) {
            return;
          }

          const transcript = message.transcript || '';
          const utterance = message.utterance || '';
          const isFinal = message.end_of_turn;

          if (!transcript) return;

          if (!isFinal) {
            // Send partial transcript
            const textToSend = utterance || transcript;
            if (textToSend) {
              this.sendPartialTranscript(sessionId, nextInteractionId, textToSend);

              if (connection?.onSpeechDetected && !speechDetected) {
                logger.info({ sessionId, iteration, interactionId: nextInteractionId }, `AssemblyAI speech detected [iteration:${iteration}]`);
                speechDetected = true;
                connection.onSpeechDetected(nextInteractionId);
              }
            }
            return;
          }

          // Final transcript
          logger.info({ sessionId, iteration, transcript }, `AssemblyAI turn detected ${formatSession(sessionId)} [iteration:${iteration}]: "${transcript.substring(0, 50)}..."`);

          transcriptText = transcript;
          turnDetected = true;
          if (session) session.shouldStopProcessing = true;
          turnResolve(transcript);

        } else if (msgType === 'Termination') {
          logger.info({ sessionId, iteration }, `AssemblyAI session terminated ${formatSession(sessionId)} [iteration:${iteration}]`);
        }
      } catch (error) {
        logger.error({ err: error, sessionId, iteration }, `AssemblyAI error handling message [iteration:${iteration}]`);
      }
    };

    try {
      // Ensure WebSocket connection is ready
      await session.ensureConnection();

      // Attach message handler
      session.onMessage(messageHandler);

      // Process multimodal content (audio chunks)
      const audioProcessingPromise = (async () => {
        let maxDurationTimeout: NodeJS.Timeout | null = null;
        try {
          logger.debug({ sessionId, iteration }, 'AssemblyAI WS STT - Starting multimodal processing loop');


          // Safety timer: prevent infinite loops if no turn is detected
          maxDurationTimeout = setTimeout(() => {
            maxDurationReached = true; // Ensure maximum process() execution length doesn't exceed 40. If the player with an active mic does not speak for 60s, the node executor will error out thinking it's a zombie node
            // We'll loop back in the graph and continue after timing out
          }, this.MAX_TRANSCRIPTION_DURATION_MS);

          while (true) {
            if (session?.shouldStopProcessing) {
              break;
            }

            if (maxDurationReached) {
              if (!transcriptText) {
                logger.warn({ sessionId, iteration }, `AssemblyAI max transcription duration reached [limit:${this.MAX_TRANSCRIPTION_DURATION_MS}ms]`);
                break;
              }
            }

            const result = await multimodalStream.next();

            if (result.done) {
              logger.info({ sessionId, iteration, audioChunkCount }, `AssemblyAI multimodal stream exhausted [iteration:${iteration}] [chunks:${audioChunkCount}]`);
              isStreamExhausted = true;
              break;
            }

            if (session?.shouldStopProcessing) break;

            const content = result.value as GraphTypes.MultimodalContent;

            // Handle text input - immediately simulate turn detection
            if (content.text !== undefined && content.text !== null) {
              logger.info({ sessionId, iteration, text: content.text }, `AssemblyAI text input detected [iteration:${iteration}]: "${content.text.substring(0, 50)}..."`);
              isTextInput = true;
              textContent = content.text;
              transcriptText = content.text;
              turnDetected = true;
              if (session) session.shouldStopProcessing = true;
              turnResolve(transcriptText);
              // For text input, we immediately complete and bypass STT
              break;
            }

            // Extract audio from MultimodalContent
            if (content.audio === undefined || content.audio === null) {
              continue;
            }

            const audioData = content.audio.data;
            if (!audioData || audioData.length === 0) {
              continue;
            }

            // Convert to Float32Array if needed
            const float32Data = Array.isArray(audioData)
              ? new Float32Array(audioData)
              : audioData;

            audioChunkCount++;
            totalAudioSamples += float32Data.length;

            const pcm16Data = float32ToPCM16(float32Data);

            session?.sendAudio(pcm16Data);

            if (audioChunkCount % 20 === 0) {
               // Heartbeat log
            }
          }
        } catch (error) {
          logger.error({ err: error, sessionId, iteration }, `AssemblyAI error processing audio [iteration:${iteration}]`);
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
        audioProcessingPromise.then(() => ({ winner: 'audio' as const })), // Audio will immediately win after the stream stops manually,
      ]);

      if (raceResult.winner === 'audio' && !turnCompleted && !maxDurationReached) { // and if audio wins, we enter this race, as turnComplete is not here yet
        logger.info({ sessionId, iteration, timeout: this.TURN_COMPLETION_TIMEOUT_MS }, `AssemblyAI audio ended before turn [iteration:${iteration}], waiting ${this.TURN_COMPLETION_TIMEOUT_MS}ms for transcript`);

        // Send 100ms of silence every 100ms to keep the connection alive/processing
        const silenceIntervalMs = 100;
        const silenceSamples = Math.floor((silenceIntervalMs / 1000) * this.sampleRate);
        const silenceFrame = new Int16Array(silenceSamples);
        const silenceTimer = setInterval(() => {
          if (session && !session.shouldStopProcessing) {
            session.sendAudio(silenceFrame);
          }
        }, silenceIntervalMs); // This is critical. Assembly AI Streaming API expects constant audio stream, or it will not emit any events.
        // We need to continue streaming even if the user is not actively sending audio.

        const timeoutPromise = new Promise<{ winner: 'timeout' }>((resolve) =>
          setTimeout(() => resolve({ winner: 'timeout' }), this.TURN_COMPLETION_TIMEOUT_MS),
        );

        const waitResult = await Promise.race([
          turnPromiseWithState.then(() => ({ winner: 'turn' as const })),
          timeoutPromise,
        ]);

        // We either timed out here or received a final turn event
        clearInterval(silenceTimer);

        if (waitResult.winner === 'timeout' && !turnCompleted) {
          logger.warn({ sessionId, iteration }, `AssemblyAI timed out waiting for turn [iteration:${iteration}]`);
          turnReject?.(new Error('Timed out waiting for turn completion'));
        }
      }

      // Ensure the audio processing loop fully exits before returning
      await audioProcessingPromise.catch(() => {});

      logger.info({ sessionId, iteration, transcript: transcriptText }, `AssemblyAI transcription complete [iteration:${iteration}]: "${transcriptText?.substring(0, 50)}..."`);

      // Clear interactionId on turn completion
      if (turnDetected) {
        logger.info({ sessionId, iteration, interactionId: nextInteractionId }, 'AssemblyAI clearing interactionId after turn completion');
        connection.state.interactionId = '';
      }

      // Tag the stream with type for runtime
      const taggedStream = Object.assign(multimodalStream, {
        type: 'MultimodalContent',
        abort: () => {
          // No-op abort handler
        },
      });

      return new DataStreamWithMetadata(taggedStream as any, {
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
        endpointing_latency_ms: 0,
        // Flags to match native graph structure
        is_running: !isStreamExhausted,
        is_text_input: isTextInput,
        is_interruption: false, // Not currently handling interruptions in this node
        text_content: textContent,
      });

    } catch (error) {
      logger.error({ err: error, sessionId, iteration }, `AssemblyAI transcription failed [iteration:${iteration}]`);

      // Tag the stream with type for runtime
      const taggedStream = Object.assign(multimodalStream, {
        type: 'MultimodalContent',
        abort: () => {
          // No-op abort handler
        },
      });

      return new DataStreamWithMetadata(taggedStream as any, {
        elementType: 'MultimodalContent',
        iteration: iteration,
        interactionId: nextInteractionId,
        session_id: sessionId,
        assembly_session_id: session?.assemblySessionId || '',
        transcript: '',
        turn_detected: false,
        audio_chunk_count: audioChunkCount,
        total_audio_samples: totalAudioSamples,
        sample_rate: this.sampleRate,
        stream_exhausted: isStreamExhausted,
        interaction_complete: false,
        error_occurred: true,
        error_message: error instanceof Error ? error.message : String(error),
        endpointing_latency_ms: 0,
        // Flags to match native graph structure
        is_running: !isStreamExhausted,
        is_text_input: isTextInput,
        is_interruption: false, // Not currently handling interruptions in this node
        text_content: textContent,
      });
    }
    finally {
      // Clean up message handler after execution ends
      if (session) {
        session.offMessage(messageHandler);
      }
    }
  }

  /**
   * Send partial transcript update to the client for real-time feedback
   */
  private sendPartialTranscript(
    sessionId: string,
    interactionId: string,
    text: string,
  ): void {
    const connection = this.connections[sessionId];
    if (!connection || !connection.ws) {
      return;
    }

    try {
      if (connection.onPartialTranscript) {
        connection.onPartialTranscript(text, interactionId);
      }
    } catch (error) {
      logger.error({ err: error, sessionId }, 'AssemblyAI error sending partial transcript');
    }
  }

  /**
   * Update turn detection configuration for a specific session
   */
  updateTurnDetectionSettings(
    sessionId: string,
    settings: {
      endOfTurnConfidenceThreshold: number;
      minEndOfTurnSilenceWhenConfident: number;
      maxTurnSilence: number;
    }
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.warn({ sessionId }, 'AssemblyAI cannot update settings: no active session');
      return;
    }

    // Update the node's stored settings
    this.endOfTurnConfidenceThreshold = settings.endOfTurnConfidenceThreshold;
    this.minEndOfTurnSilenceWhenConfident = settings.minEndOfTurnSilenceWhenConfident;
    this.maxTurnSilence = settings.maxTurnSilence;

    logger.info({ sessionId, settings }, 'AssemblyAI updating turn detection');

    // Send UpdateConfiguration message to active AssemblyAI WebSocket
    session.updateConfiguration(settings);
  }

  /**
   * Close a specific session by sessionId
   */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      logger.info(`[AssemblyAI WS STT] Closing session: ${sessionId}`);
      await session.close();
      this.sessions.delete(sessionId);
      logger.info(`[AssemblyAI WS STT] Session ${sessionId} closed and removed`);
    }
  }

  /**
   * Clean up resources
   */
  async destroy(): Promise<void> {
    logger.info({ sessionCount: this.sessions.size }, `AssemblyAI destroying node: closing ${this.sessions.size} WebSocket connections`);

    const promises: Promise<void>[] = [];
    for (const session of this.sessions.values()) {
        promises.push(session.close());
    }

    await Promise.all(promises);
    this.sessions.clear();
    logger.info('AssemblyAI all sessions cleaned up');
  }
}
