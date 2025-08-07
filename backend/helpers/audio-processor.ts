import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { ContentStreamIterator } from '@inworld/runtime/common';
import { SileroVAD, VADConfig } from './silero-vad.js';
import { createConversationGraph } from '../graphs/conversation-graph.js';

const AUDIO_DEBUG_DIR = path.join(process.cwd(), 'backend', 'audio');

export class AudioProcessor {
  private executor: any;
  private vad: SileroVAD | null = null;
  private isProcessing = false;
  private isReady = false;
  private websocket: any = null;
  private debugCounter = 0;

  constructor(private apiKey: string, websocket?: any) {
    this.websocket = websocket;
    setTimeout(() => this.initialize(), 100);
  }

  private async initialize() {
    console.log('AudioProcessor: Starting initialization...');
    
    // Initialize VAD
    try {
      const vadConfig: VADConfig = {
        modelPath: '/Users/cale/code/aprendemo/backend/models/silero_vad.onnx',
        threshold: 0.5,  // Following working example SPEECH_THRESHOLD
        minSpeechDuration: 0.2,  // MIN_SPEECH_DURATION_MS / 1000
        minSilenceDuration: 0.65, // PAUSE_DURATION_THRESHOLD_MS / 1000
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
      });
      
      this.vad.on('speechEnd', async (event) => {
        console.log('🔇 Speech ended, duration:', event.speechDuration.toFixed(2) + 's');
        await this.processVADSpeechSegment(event.speechSegment);
      });
      
    } catch (error) {
      console.error('AudioProcessor: VAD initialization failed:', error);
      this.vad = null;
    }
    
    // Initialize conversation graph
    console.log('AudioProcessor: Creating conversation graph...');
    this.executor = createConversationGraph({ apiKey: this.apiKey });
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
      await this.saveAudioDebug(amplifiedSegment, 'vad-segment');

      const outputStream = await this.executor.execute(
        {
          data: Array.from(amplifiedSegment),
          sampleRate: 16000,
        },
        uuidv4(),
      );

      let transcription = '';
      let chunk = await outputStream.next();

      while (!chunk.done) {
        console.log(`VAD Chunk type: ${chunk.type}`);
        
        switch (chunk.type) {
          case 'TTS_OUTPUT_STREAM':
            console.log('VAD Processing TTS audio stream...');
            if (chunk.data && this.websocket) {
              const ttsStreamIterator = chunk.data;
              console.log('VAD TTS Stream iterator:', ttsStreamIterator);
              
              if (ttsStreamIterator?.next) {
                let ttsChunk = await ttsStreamIterator.next();
                
                while (!ttsChunk.done) {
                  console.log('VAD TTS chunk:', ttsChunk);
                  
                  if (ttsChunk.audio && ttsChunk.audio.data) {
                    // Convert Float32Array audio data to base64
                    const audioData = new Float32Array(ttsChunk.audio.data);
                    const int16Array = new Int16Array(audioData.length);
                    
                    // Convert Float32 to Int16
                    for (let i = 0; i < audioData.length; i++) {
                      int16Array[i] = Math.max(-32768, Math.min(32767, audioData[i] * 32767));
                    }
                    
                    const base64Audio = Buffer.from(int16Array.buffer).toString('base64');
                    
                    this.websocket.send(JSON.stringify({
                      type: 'audio_stream',
                      audio: base64Audio,
                      sampleRate: ttsChunk.audio.sampleRate || 16000,
                      timestamp: Date.now(),
                      text: ttsChunk.text || ''
                    }));
                  }
                  
                  ttsChunk = await ttsStreamIterator.next();
                }
              }
            }
            break;
          case 'TEXT':
            if (chunk.data) {
              transcription = chunk.data;
              console.log(`VAD STT Transcription: "${transcription}"`);
              
              if (this.websocket) {
                this.websocket.send(JSON.stringify({
                  type: 'transcription',
                  text: transcription.trim(),
                  timestamp: Date.now()
                }));
              }
            }
            break;
            
          case 'CONTENT_STREAM':
            const streamIterator = chunk.data as ContentStreamIterator;
            console.log('VAD Processing LLM stream...');
            
            let llmResponse = '';
            while (true) {
              const streamChunk = await streamIterator.next();
              if (streamChunk.done) {
                break;
              }
              
              if (streamChunk.text) {
                llmResponse += streamChunk.text;
                console.log('VAD LLM chunk:', streamChunk.text);
                
                if (this.websocket) {
                  this.websocket.send(JSON.stringify({
                    type: 'llm_response_chunk',
                    text: streamChunk.text,
                    timestamp: Date.now()
                  }));
                }
              }
            }
            
            if (llmResponse.trim()) {
              console.log(`VAD Complete LLM Response: "${llmResponse}"`);
              
              if (this.websocket) {
                this.websocket.send(JSON.stringify({
                  type: 'llm_response_complete',
                  text: llmResponse.trim(),
                  timestamp: Date.now()
                }));
              }
            }
            break;
            
          default:
            console.log(`VAD Unknown chunk type: ${chunk.type}`, chunk.data);
            if (chunk.data) {
              transcription += chunk.data;
            }
        }
        
        chunk = await outputStream.next();
      }

      if (transcription.trim()) {
        return transcription;
      }

    } catch (error) {
      console.error('Error processing VAD speech segment:', error);
    } finally {
      this.isProcessing = false;
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
}