import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { GraphTypes } from '@inworld/runtime/common';
import { UserContext } from '@inworld/runtime/graph';
import { SileroVAD, VADConfig } from './silero-vad.js';
import { createConversationGraph } from '../graphs/conversation-graph.js';
import type { IntroductionState } from './introduction-state-processor.ts';
import { HandlerContextImpl } from '../handlers/handler-context.js';
import { handleString } from '../handlers/string-handler.js';
import { handleContent } from '../handlers/content-handler.js';
import { handleContentStream } from '../handlers/content-stream-handler.js';
import { handleTTSOutputStream } from '../handlers/tts-output-stream-handler.js';
import { handleToolCallResponse } from '../handlers/tool-call-handler.js';

const AUDIO_DEBUG_DIR = path.join(process.cwd(), 'backend', 'audio');

export class AudioProcessor {
  private executor: any;
  private vad: SileroVAD | null = null;
  private isProcessing = false;
  private isProcessingCancelled = false;  // Track if current processing should be cancelled
  private isReady = false;
  private websocket: any = null;
  private debugCounter = 0;
  private currentOutputStream: any | null = null;
  private pendingSpeechSegments: Float32Array[] = [];  // Accumulate speech segments
  private conversationState: { messages: Array<{ role: string; content: string; timestamp: string }> } = {
    messages: []
  };
  private flashcardCallback: ((messages: Array<{ role: string; content: string }>) => Promise<void>) | null = null;
  private introductionState: IntroductionState = { name: '', level: '', goal: '', timestamp: '' };
  private introductionStateCallback: ((messages: Array<{ role: string; content: string }>) => Promise<IntroductionState | null>) | null = null;
  private targetingKey: string | null = null;
  private clientTimezone: string | null = null;
  private graphStartTime: number = 0;
  constructor(private apiKey: string, websocket?: any) {
    this.websocket = websocket;
    this.setupWebSocketMessageHandler();
    setTimeout(() => this.initialize(), 100);
  }

  private trimConversationHistory(maxTurns: number = 40) {
    const maxMessages = maxTurns * 2;
    if (this.conversationState.messages.length > maxMessages) {
      this.conversationState.messages = this.conversationState.messages.slice(-maxMessages);
    }
  }

  // Public method to process direct text input (bypasses STT)
  async processTextInput(text: string): Promise<void> {
    try {
      if (!this.executor) {
        console.warn('Executor not ready yet');
        return;
      }

      // Update transcription state and notify frontend like STT would
      const transcription = text.trim();
      const handlerContext = new HandlerContextImpl(
        this.websocket,
        this.conversationState,
        this.introductionState,
        Date.now(),
        this.flashcardCallback,
        this.introductionStateCallback,
        (maxTurns: number) => this.trimConversationHistory(maxTurns)
      );
      handlerContext.updateTranscription(transcription);
      handlerContext.sendWebSocketMessage({
        type: 'transcription',
        text: transcription,
        timestamp: Date.now()
      });

      // Build user context similar to audio path
      const attributes: Record<string, string> = {
        timezone: this.clientTimezone || '',
      };
      attributes.name = (this.introductionState?.name && this.introductionState.name.trim()) || 'unknown';
      attributes.level = (this.introductionState?.level && (this.introductionState.level as string)) || 'unknown';
      attributes.goal = (this.introductionState?.goal && this.introductionState.goal.trim()) || 'unknown';
      const targetingKey = this.targetingKey || uuidv4();
      const userContext = new UserContext(attributes, targetingKey);

      // Start graph with text input via input_router_node
      let outputStream;
      this.graphStartTime = Date.now();
      try {
        outputStream = await this.executor.start(transcription, uuidv4(), userContext, 'input_router_node');
      } catch (err) {
        console.warn('Executor.start(text) with UserContext failed, falling back without context:', err);
        outputStream = await this.executor.start(transcription, uuidv4(), undefined, 'input_router_node');
      }

      this.currentOutputStream = outputStream;
      for await (const chunk of outputStream) {
        await chunk.processResponse({
          string: async (data: string) => {
            // When starting from text, we already sent transcription; still update internal state
            await handleString(data, handlerContext);
          },
          Content: async (content: GraphTypes.Content) => {
            await handleContent(content, handlerContext);
          },
          ContentStream: async (streamIterator: GraphTypes.ContentStream) => {
            await handleContentStream(streamIterator, handlerContext);
          },
          TTSOutputStream: async (ttsStreamIterator: GraphTypes.TTSOutputStream) => {
            await handleTTSOutputStream(ttsStreamIterator, handlerContext);
          },
          ToolCallResponse: async (toolResponse: GraphTypes.ToolCallResponse) => {
            await handleToolCallResponse(toolResponse, handlerContext);
          },
          default: (data: any) => {
            console.log(`TextInput Unknown/unhandled chunk type: ${chunk.typeName}`, data);
          }
        });
      }

      this.introductionState = handlerContext.introductionState;
    } catch (error) {
      console.error('Error processing text input:', error);
    } finally {
      this.currentOutputStream = null;
    }
  }

  private setupWebSocketMessageHandler() {
    if (this.websocket) {
      this.websocket.on('message', (data: any) => {
        try {
          const raw = typeof data === 'string' ? data : data?.toString?.() || '';
          const message = JSON.parse(raw);
          
          if (message.type === 'conversation_update') {
            const incoming = (message.data && message.data.messages) ? message.data.messages : [];
            const existing = this.conversationState.messages || [];
            const combined = [...existing, ...incoming];
            const seen = new Set<string>();
            const deduped: Array<{ role: string; content: string; timestamp: string }> = [];
            for (const m of combined) {
              const key = `${m.timestamp}|${m.role}|${m.content}`;
              if (!seen.has(key)) {
                seen.add(key);
                deduped.push(m);
              }
            }
            deduped.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
            this.conversationState = { messages: deduped };
            this.trimConversationHistory(40);
          } else if (message.type === 'user_context') {
            // Persist minimal attributes for user context
            const tz = message.timezone || (message.data && message.data.timezone) || '';
            const uid = message.userId || (message.data && message.data.userId) || '';
            this.clientTimezone = tz || this.clientTimezone;
            if (uid) this.targetingKey = uid;
          }
        } catch (error) {
          // Not a JSON message or conversation update, ignore
        }
      });
    }
  }

  private getConversationState() {
    return this.conversationState;
  }

  setFlashcardCallback(callback: (messages: Array<{ role: string; content: string }>) => Promise<void>) {
    this.flashcardCallback = callback;
  }

  setIntroductionStateCallback(callback: (messages: Array<{ role: string; content: string }>) => Promise<IntroductionState | null>) {
    this.introductionStateCallback = callback;
  }

  getIntroductionState(): IntroductionState {
    return this.introductionState;
  }

  private async initialize() {
    console.log('AudioProcessor: Starting initialization...');
    
    // Initialize VAD
    try {
      const vadConfig: VADConfig = {
        modelPath: 'backend/models/silero_vad.onnx',
        threshold: 0.5,  // Following working example SPEECH_THRESHOLD
        minSpeechDuration: 0.2,  // MIN_SPEECH_DURATION_MS / 1000
        minSilenceDuration: 0.4, // Reduced from 0.65 for faster response
        speechResetSilenceDuration: 1.0,
        minVolume: 0.01, // Lower threshold to start - can adjust based on testing
        sampleRate: 16000
      };
      
      console.log('AudioProcessor: Creating SileroVAD with config:', vadConfig);
      this.vad = new SileroVAD(vadConfig);
      
      console.log('AudioProcessor: Initializing VAD...');
      await this.vad.initialize();
      console.log('AudioProcessor: VAD initialized successfully');
      
      this.vad.on('speechStart', (event) => {
        console.log('🎤 Speech started');
        
        // Always notify frontend to stop audio playback when user starts speaking
        if (this.websocket) {
          try {
            this.websocket.send(JSON.stringify({ type: 'interrupt', reason: 'speech_start' }));
          } catch (_) {
            // ignore send errors
          }
        }
        
        // If we're currently processing, set cancellation flag
        if (this.isProcessing) {
          console.log('Setting cancellation flag - user started speaking during processing');
          this.isProcessingCancelled = true;
          // Don't clear segments - we want to accumulate them
        }
      });
      
      this.vad.on('speechEnd', async (event) => {
        console.log('🔇 Speech ended, duration:', event.speechDuration.toFixed(2) + 's');
        
        try {
          if (event.speechSegment && event.speechSegment.length > 0) {
            // Add this segment to pending segments
            this.pendingSpeechSegments.push(event.speechSegment);
            
            // Reset cancellation flag for new processing
            this.isProcessingCancelled = false;
            
            // Process immediately if not already processing
            if (!this.isProcessing && this.pendingSpeechSegments.length > 0) {
              // Combine all pending segments
              const totalLength = this.pendingSpeechSegments.reduce((sum, seg) => sum + seg.length, 0);
              const combinedSegment = new Float32Array(totalLength);
              let offset = 0;
              for (const seg of this.pendingSpeechSegments) {
                combinedSegment.set(seg, offset);
                offset += seg.length;
              }
              
              // Clear pending segments
              this.pendingSpeechSegments = [];
              
              // Process immediately
              console.log('Processing speech segment immediately');
              await this.processVADSpeechSegment(combinedSegment);
            }
          }
        } catch (error) {
          console.error('Error handling speech segment:', error);
        }
      });
      
    } catch (error) {
      console.error('AudioProcessor: VAD initialization failed:', error);
      this.vad = null;
    }
    
    // Initialize conversation graph
    console.log('AudioProcessor: Creating conversation graph...');
    this.executor = createConversationGraph(
      { apiKey: this.apiKey },
      () => this.getConversationState(),
      () => this.getIntroductionState()
    );
    this.executor.visualize('conversation-graph.png');
    this.isReady = true;
    console.log('AudioProcessor: Initialization complete, ready for audio processing');
  }

  addAudioChunk(base64Audio: string) {
    try {
      // Feed audio to VAD if available and ready
      if (this.vad && this.isReady) {
        this.vad.addAudioData(base64Audio);
      } else {
        // VAD not available - log error and ignore audio chunk
        if (!this.vad) {
          console.error('VAD not available - cannot process audio chunk');
        } else if (!this.isReady) {
          console.warn('AudioProcessor not ready yet - ignoring audio chunk');
        }
      }
    } catch (error) {
      console.error('Error processing audio chunk:', error);
    }
  }


  private amplifyAudio(audioData: Float32Array, gain: number): Float32Array {
    const amplified = new Float32Array(audioData.length);
    
    let maxVal = 0;
    for (let i = 0; i < audioData.length; i++) {
      const absVal = Math.abs(audioData[i]);
      if (absVal > maxVal) {
        maxVal = absVal;
      }
    }
    
    // For normalized Float32 audio [-1, 1], prevent clipping at 1.0
    const safeGain = maxVal > 0 ? Math.min(gain, 0.95 / maxVal) : gain;
    
    for (let i = 0; i < audioData.length; i++) {
      // Clamp to [-1, 1] range to prevent distortion
      amplified[i] = Math.max(-1, Math.min(1, audioData[i] * safeGain));
    }
    
    return amplified;
  }

  private createWavHeader(sampleRate: number, numChannels: number, bitsPerSample: number, dataSize: number): Buffer {
    const header = Buffer.alloc(44);
    let offset = 0;

    // RIFF header
    header.write('RIFF', offset); offset += 4;
    header.writeUInt32LE(36 + dataSize, offset); offset += 4; // File size - 8
    header.write('WAVE', offset); offset += 4;

    // fmt chunk
    header.write('fmt ', offset); offset += 4;
    header.writeUInt32LE(16, offset); offset += 4; // fmt chunk size
    header.writeUInt16LE(1, offset); offset += 2; // Audio format (1 = PCM)
    header.writeUInt16LE(numChannels, offset); offset += 2;
    header.writeUInt32LE(sampleRate, offset); offset += 4;
    header.writeUInt32LE(sampleRate * numChannels * bitsPerSample / 8, offset); offset += 4; // Byte rate
    header.writeUInt16LE(numChannels * bitsPerSample / 8, offset); offset += 2; // Block align
    header.writeUInt16LE(bitsPerSample, offset); offset += 2;

    // data chunk
    header.write('data', offset); offset += 4;
    header.writeUInt32LE(dataSize, offset);

    return header;
  }

  private async saveAudioDebug(audioData: Float32Array, source: string): Promise<void> {
    try {
      this.debugCounter++;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${source}_${timestamp}_${this.debugCounter.toString().padStart(3, '0')}.wav`;
      const filepath = path.join(AUDIO_DEBUG_DIR, filename);

      // Ensure directory exists
      if (!fs.existsSync(AUDIO_DEBUG_DIR)) {
        fs.mkdirSync(AUDIO_DEBUG_DIR, { recursive: true });
      }

      // Convert Float32 to 16-bit PCM
      const int16Data = new Int16Array(audioData.length);
      for (let i = 0; i < audioData.length; i++) {
        // Clamp to [-1, 1] and convert to 16-bit
        const sample = Math.max(-1, Math.min(1, audioData[i]));
        int16Data[i] = Math.round(sample * 32767);
      }

      const dataBuffer = Buffer.from(int16Data.buffer);
      const header = this.createWavHeader(16000, 1, 16, dataBuffer.length);
      const wavBuffer = Buffer.concat([header, dataBuffer]);

      fs.writeFileSync(filepath, wavBuffer);
      
      console.log(`Debug audio saved: ${filename} (${audioData.length} samples)`);
    } catch (error) {
      console.error('Error saving debug audio:', error);
    }
  }

  private async processVADSpeechSegment(speechSegment: Float32Array) {
    if (this.isProcessing) {
      return;
    }
    
    this.isProcessing = true;

    try {
      const amplifiedSegment = this.amplifyAudio(speechSegment, 2.0);

      // Save debug audio before sending to STT
      // await this.saveAudioDebug(amplifiedSegment, 'vad-segment');

      // Create Audio instance for STT node
      const audioInput = new GraphTypes.Audio({
        data: Array.from(amplifiedSegment),
        sampleRate: 16000,
      });

      // Build user context for experiments
      const attributes: Record<string, string> = {
        timezone: this.clientTimezone || '',
      };
      attributes.name = (this.introductionState?.name && this.introductionState.name.trim()) || 'unknown';
      attributes.level = (this.introductionState?.level && (this.introductionState.level as string)) || 'unknown';
      attributes.goal = (this.introductionState?.goal && this.introductionState.goal.trim()) || 'unknown';

      const targetingKey = this.targetingKey || uuidv4();
      const userContext = new UserContext(attributes, targetingKey);
      console.log(userContext)
      let outputStream;
      this.graphStartTime = Date.now();
      try {
        outputStream = await this.executor.start(
          audioInput,
          uuidv4(),
          userContext,
          'input_router_node'
        );
      } catch (err) {
        console.warn('Executor.start with UserContext failed, falling back without context:', err);
        outputStream = await this.executor.start(
          audioInput,
          uuidv4(),
          undefined,
          'input_router_node'
        );
      }

      // Create handler context with all necessary dependencies
      const handlerContext = new HandlerContextImpl(
        this.websocket,
        this.conversationState,
        this.introductionState,
        this.graphStartTime,
        this.flashcardCallback,
        this.introductionStateCallback,
        (maxTurns: number) => this.trimConversationHistory(maxTurns)
      );

      // Track the current output stream so it can be cancelled on interruption
      this.currentOutputStream = outputStream;

      for await (const chunk of outputStream) {
        // Check if processing has been cancelled
        if (this.isProcessingCancelled) {
          console.log('Processing cancelled by user speech, breaking from loop');
          break;
        }
        
        console.log(`Audio Processor:Chunk received - Type: ${chunk.typeName}, Has processResponse: ${typeof chunk.processResponse === 'function'}`);
        console.log(`Audio Processor:Time since graph started: ${Date.now() - this.graphStartTime}ms`);
        
        // Use processResponse for type-safe handling
        await chunk.processResponse({
          // Handle string output (from ProxyNode with STT transcription)
          string: async (data: string) => {
            await handleString(data, handlerContext);
          },
          
          // non streaming LLM response
          Content: async (content: GraphTypes.Content) => {
            await handleContent(content, handlerContext);
          },

          // Handle ContentStream (from LLM 2)
          ContentStream: async (streamIterator: GraphTypes.ContentStream) => {
            await handleContentStream(streamIterator, handlerContext);
          },
          
          // Handle TTS output stream
          TTSOutputStream: async (ttsStreamIterator: GraphTypes.TTSOutputStream) => {
            await handleTTSOutputStream(ttsStreamIterator, handlerContext);
          },
          
          // Handle tool call responses
          ToolCallResponse: async (toolResponse: GraphTypes.ToolCallResponse) => {
            await handleToolCallResponse(toolResponse, handlerContext);
          },
          
          // Handle any other type
          default: (data: any) => {
            console.log(`VAD Unknown/unhandled chunk type: ${chunk.typeName}`, data);
          }
        });
        
        // Check again after processing each chunk
        if (this.isProcessingCancelled) {
          console.log('Processing cancelled after chunk processing');
          break;
        }
      }

      // Update internal state from handler context
      this.introductionState = handlerContext.introductionState;
      
      if (handlerContext.transcription.trim()) {
        return handlerContext.transcription;
      }

    } catch (error) {
      console.error('Error processing VAD speech segment:', error);
    } finally {
      this.isProcessing = false;
      // Clear tracked stream reference
      this.currentOutputStream = null;
      
      // If we have pending segments (user spoke while we were processing), process them now
      if (this.pendingSpeechSegments.length > 0 && !this.isProcessingCancelled) {
        console.log('Found pending segments after processing, processing them now');
        
        // Combine all pending segments
        const totalLength = this.pendingSpeechSegments.reduce((sum, seg) => sum + seg.length, 0);
        const combinedSegment = new Float32Array(totalLength);
        let offset = 0;
        for (const seg of this.pendingSpeechSegments) {
          combinedSegment.set(seg, offset);
          offset += seg.length;
        }
        
        // Clear pending segments
        this.pendingSpeechSegments = [];
        
        // Process the combined segments recursively
        await this.processVADSpeechSegment(combinedSegment);
      }
    }
  }


  destroy() {
    if (this.executor) {
      this.executor.cleanupAllExecutions();
      this.executor.destroy();
    }
    
    if (this.vad) {
      this.vad.destroy();
      this.vad = null;
    }
  }

  // Simple interrupt method using cancellation flag
  private interrupt(reason?: string) {
    // Just set the cancellation flag, don't try to force-close
    this.isProcessingCancelled = true;
    console.log(`Interrupt requested: ${reason}`);
  }

}