import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { GraphTypes } from '@inworld/runtime/common';
import { UserContext } from '@inworld/runtime/graph';
import { SileroVAD, VADConfig } from './silero-vad.js';
import { createConversationGraph } from '../graphs/conversation-graph.js';
import type { IntroductionState } from './introduction-state-processor.ts';

const AUDIO_DEBUG_DIR = path.join(process.cwd(), 'backend', 'audio');

export class AudioProcessor {
  private executor: any;
  private vad: SileroVAD | null = null;
  private isProcessing = false;
  private isReady = false;
  private websocket: any = null;
  private debugCounter = 0;
  private currentOutputStream: any | null = null;
  private debounceTimeoutMs: number = 2000;
  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingSpeechSegments: Float32Array[] = [];  // Accumulate speech segments
  private conversationState: { messages: Array<{ role: string; content: string; timestamp: string }> } = {
    messages: []
  };
  private flashcardCallback: ((messages: Array<{ role: string; content: string }>) => Promise<void>) | null = null;
  private introductionState: IntroductionState = { name: '', level: '', goal: '', timestamp: '' };
  private introductionStateCallback: ((messages: Array<{ role: string; content: string }>) => Promise<IntroductionState | null>) | null = null;
  private targetingKey: string | null = null;
  private clientTimezone: string | null = null;
  private hasMergedInitialHistory = false;

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

  private setupWebSocketMessageHandler() {
    if (this.websocket) {
      this.websocket.on('message', (data: any) => {
        try {
          const raw = typeof data === 'string' ? data : data?.toString?.() || '';
          const message = JSON.parse(raw);
          
          if (message.type === 'conversation_update') {
            if (this.hasMergedInitialHistory) {
              // Ignore subsequent client history updates to avoid duplicates; server is source of truth
              return;
            }
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
            this.hasMergedInitialHistory = true;
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
        
        // If we have a pending debounce timer, it means we were about to process
        // but the user started speaking again - cancel processing and keep accumulating
        if (this.debounceTimer) {
          console.log('User resumed speaking - cancelling pending processing');
          clearTimeout(this.debounceTimer);
          this.debounceTimer = null;
          
          // If we're currently processing, interrupt graph execution
          if (this.isProcessing) {
            this.interrupt('speech_resumed');
          }
        } else if (this.isProcessing) {
          // User started speaking while we're processing - interrupt graph execution
          this.interrupt('speech_start');
        }
      });
      
      this.vad.on('speechEnd', async (event) => {
        console.log('🔇 Speech ended, duration:', event.speechDuration.toFixed(2) + 's');
        
        try {
          if (event.speechSegment && event.speechSegment.length > 0) {
            // Add this segment to pending segments
            this.pendingSpeechSegments.push(event.speechSegment);
            
            // Cancel any existing debounce timer
            if (this.debounceTimer) {
              clearTimeout(this.debounceTimer);
            }
            
            // Set a timer to process after debounce period
            this.debounceTimer = setTimeout(async () => {
              this.debounceTimer = null;
              
              // Only process if not already processing
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
                
                // Process the combined segment
                console.log('Processing combined speech segment after debounce');
                await this.processVADSpeechSegment(combinedSegment);
              }
            }, this.debounceTimeoutMs);
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
      try {
        outputStream = await this.executor.start(
          audioInput,
          uuidv4(),
          userContext,
        );
      } catch (err) {
        console.warn('Executor.start with UserContext failed, falling back without context:', err);
        outputStream = await this.executor.start(
          audioInput,
          uuidv4(),
        );
      }

      let transcription = '';
      let llmResponse = '';

      // Track the current output stream so it can be cancelled on interruption
      this.currentOutputStream = outputStream;

      for await (const chunk of outputStream) {
        console.log(`VAD Chunk received - Type: ${chunk.typeName}, Has processResponse: ${typeof chunk.processResponse === 'function'}`);
        
        // Use processResponse for type-safe handling
        await chunk.processResponse({
          // Handle string output (from ProxyNode with STT transcription)
          string: (data: string) => {
            transcription = data;
            console.log(`VAD STT Transcription (via ProxyNode): "${transcription}"`);
            if (this.websocket) {
              this.websocket.send(JSON.stringify({
                type: 'transcription',
                text: transcription.trim(),
                timestamp: Date.now()
              }));
            }
            // Don't add to conversation state yet - the prompt template will use it as current_input
            // We'll add it after processing completes

            // Opportunistically run introduction-state extraction as soon as we have user input
            const isIntroCompleteEarly = Boolean(this.introductionState?.name && this.introductionState?.level && this.introductionState?.goal);
            if (!isIntroCompleteEarly && this.introductionStateCallback) {
              const recentMessages = this.conversationState.messages.slice(-6).map(msg => ({
                role: msg.role,
                content: msg.content
              }));
              this.introductionStateCallback(recentMessages)
                .then((state) => {
                  if (state) {
                    this.introductionState = state;
                    if (this.websocket) {
                      this.websocket.send(JSON.stringify({
                        type: 'introduction_state_updated',
                        introduction_state: this.introductionState,
                        timestamp: Date.now()
                      }));
                    }
                  }
                })
                .catch((error) => {
                  console.error('Error in introduction-state callback (early):', error);
                });
            }
          },
          
          // Handle ContentStream (from LLM)
          ContentStream: async (streamIterator: GraphTypes.ContentStream) => {
            console.log('VAD Processing LLM ContentStream...');
            let currentLLMResponse = '';
            for await (const streamChunk of streamIterator) {
              if (streamChunk.text) {
                currentLLMResponse += streamChunk.text;
                // console.log('VAD LLM chunk:', streamChunk.text);
                if (this.websocket) {
                  this.websocket.send(JSON.stringify({
                    type: 'llm_response_chunk',
                    text: streamChunk.text,
                    timestamp: Date.now()
                  }));
                }
              }
            }
            if (currentLLMResponse.trim()) {
              llmResponse = currentLLMResponse;
              console.log(`VAD Complete LLM Response: "${llmResponse}"`);
              if (this.websocket) {
                this.websocket.send(JSON.stringify({
                  type: 'llm_response_complete',
                  text: llmResponse.trim(),
                  timestamp: Date.now()
                }));
              }
              // Now update conversation state with both user and assistant messages
              // Add user message first (it wasn't added earlier to avoid duplication)
              this.conversationState.messages.push({
                role: 'user',
                content: transcription.trim(),
                timestamp: new Date().toISOString()
              });
              // Then add assistant message
              this.conversationState.messages.push({
                role: 'assistant',
                content: llmResponse.trim(),
                timestamp: new Date().toISOString()
              });
              this.trimConversationHistory(40);
              console.log('Updated conversation state with full exchange');
              
              // Mark that we'll need to trigger flashcard generation after TTS completes
              // We'll do this after all TTS chunks have been sent
            }
          },
          
          // Handle TTS output stream
          TTSOutputStream: async (ttsStreamIterator: GraphTypes.TTSOutputStream) => {
            console.log('VAD Processing TTS audio stream...');
            let isFirstChunk = true;
            for await (const ttsChunk of ttsStreamIterator) {
              if (ttsChunk.audio && ttsChunk.audio.data) {
                // Log first chunk for latency tracking
                if (isFirstChunk) {
                  console.log('Sending first TTS chunk immediately');
                }
                
                const audioData = new Float32Array(ttsChunk.audio.data);
                const int16Array = new Int16Array(audioData.length);
                for (let i = 0; i < audioData.length; i++) {
                  int16Array[i] = Math.max(-32768, Math.min(32767, audioData[i] * 32767));
                }
                const base64Audio = Buffer.from(int16Array.buffer).toString('base64');
                
                // Send immediately without buffering
                this.websocket.send(JSON.stringify({
                  type: 'audio_stream',
                  audio: base64Audio,
                  sampleRate: ttsChunk.audio.sampleRate || 16000,
                  timestamp: Date.now(),
                  text: ttsChunk.text || '',
                  isFirstChunk: isFirstChunk
                }));
                
                // Mark that we've sent the first chunk
                isFirstChunk = false;
              }
            }
            // Send completion signal for iOS
            console.log('VAD TTS stream complete, sending completion signal');
            this.websocket.send(JSON.stringify({
              type: 'audio_stream_complete',
              timestamp: Date.now()
            }));
            
            // Now that TTS is complete, trigger flashcard generation and other post-processing
            if (transcription && llmResponse) {
              console.log('Triggering flashcard generation after TTS completion');
              
              // Send conversation update to frontend
              if (this.websocket) {
                this.websocket.send(JSON.stringify({
                  type: 'conversation_update',
                  messages: this.conversationState.messages,
                  timestamp: Date.now()
                }));
              }
              
              // Generate flashcards - fire and forget
              if (this.flashcardCallback) {
                const recentMessages = this.conversationState.messages.slice(-6).map(msg => ({
                  role: msg.role,
                  content: msg.content
                }));
                
                this.flashcardCallback(recentMessages).catch(error => {
                  console.error('Error in flashcard generation callback:', error);
                });
              }

              // Run introduction-state extraction while incomplete
              const isIntroComplete = Boolean(this.introductionState?.name && this.introductionState?.level && this.introductionState?.goal);
              if (!isIntroComplete && this.introductionStateCallback) {
                const recentMessages = this.conversationState.messages.slice(-6).map(msg => ({
                  role: msg.role,
                  content: msg.content
                }));
                
                this.introductionStateCallback(recentMessages)
                  .then((state) => {
                    if (state) {
                      this.introductionState = state;
                      if (this.websocket) {
                        this.websocket.send(JSON.stringify({
                          type: 'introduction_state_updated',
                          introduction_state: this.introductionState,
                          timestamp: Date.now()
                        }));
                      }
                    }
                  })
                  .catch((error) => {
                    console.error('Error in introduction-state callback:', error);
                  });
              }
            }
          },
          
          // Handle any other type
          default: (data: any) => {
            console.log(`VAD Unknown/unhandled chunk type: ${chunk.typeName}`, data);
          }
        });
      }

      if (transcription.trim()) {
        return transcription;
      }

    } catch (error) {
      console.error('Error processing VAD speech segment:', error);
    } finally {
      this.isProcessing = false;
      // Clear tracked stream reference
      this.currentOutputStream = null;
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

  // Cancel current graph execution (audio stop is handled separately in speechStart)
  private interrupt(reason?: string) {
    try {
      // Don't reset VAD - it needs to maintain its speech detection state
      // But clear pending segments if we're interrupting due to new speech
      if (reason === 'speech_start') {
        this.pendingSpeechSegments = [];
      }
      // Keep segments if user is just resuming (speech_resumed)
      
      if (this.executor) {
        if (this.currentOutputStream) {
          try {
            this.executor.closeExecution(this.currentOutputStream);
          } catch (e) {
            console.warn('Failed to close specific execution, cleaning up all:', e);
            // Fallback: cleanup all executions if closing specific stream fails
            try { this.executor.cleanupAllExecutions(); } catch (_) {}
          } finally {
            this.currentOutputStream = null;
          }
        } else {
          try { this.executor.cleanupAllExecutions(); } catch (_) {}
        }
      }
    } finally {
      // Reset processing flag to allow new processing
      this.isProcessing = false;
    }
  }

}