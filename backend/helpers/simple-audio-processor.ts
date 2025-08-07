import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { SileroVAD, VADConfig } from './silero-vad.js';
import { createConversationGraph } from '../graphs/conversation-graph.js';

const AUDIO_DEBUG_DIR = path.join(process.cwd(), 'backend', 'audio');

export class SimpleAudioProcessor {
  private audioBuffer: Float32Array[] = [];
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
    // Initialize VAD
    try {
      const vadConfig: VADConfig = {
        modelPath: '/Users/cale/code/aprendemo/backend/models/silero_vad.onnx',
        threshold: 0.8,  // Lower threshold to catch quieter speech
        minSpeechDuration: 0.4,  // Shorter min speech to catch quick words
        minSilenceDuration: 1, // Longer silence required to end speech (was 0.8)
        speechResetSilenceDuration: 1.5, // More generous grace period (was 1.0)
        sampleRate: 16000
      };
      
      this.vad = new SileroVAD(vadConfig);
      await this.vad.initialize();
      
      this.vad.on('speechEnd', async (event) => {
        await this.processVADSpeechSegment(event.speechSegment);
      });
      
    } catch (error) {
      console.warn('VAD initialization failed:', error);
      this.vad = null;
    }
    
    // Initialize conversation graph
    this.executor = createConversationGraph({ apiKey: this.apiKey });
    this.isReady = true;
  }

  addAudioChunk(base64Audio: string) {
    try {
      // Feed audio to VAD if available
      if (this.vad && this.isReady) {
        this.vad.addAudioData(base64Audio);
      } else {
        // Convert and store for fallback processing
        const normalizedArray = this.convertAudioData(base64Audio);
        
        // Debug: Save first few chunks to verify frontend audio quality
        // if (this.debugCounter < 3) {
        //   this.saveAudioDebug(normalizedArray, 'frontend-input');
        // }
        
        this.audioBuffer.push(normalizedArray);
        
        if (this.audioBuffer.length > 100) {
          this.audioBuffer = this.audioBuffer.slice(-100);
        }

        // Fallback processing when VAD unavailable
        if (this.audioBuffer.length >= 20 && !this.isProcessing && this.isReady) {
          this.processAccumulatedAudio();
        }
      }
    } catch (error) {
      console.error('Error processing audio chunk:', error);
    }
  }

  private convertAudioData(base64Audio: string): Float32Array {
    const binaryString = Buffer.from(base64Audio, 'base64').toString('binary');
    const bytes = new Uint8Array(binaryString.length);
    
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const int16Array = new Int16Array(bytes.buffer);
    const normalizedArray = new Float32Array(int16Array.length);
    
    for (let i = 0; i < int16Array.length; i++) {
      normalizedArray[i] = int16Array[i] / 32768.0;
    }

    return normalizedArray;
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
        if (chunk.data) {
          transcription += chunk.data;
        }
        chunk = await outputStream.next();
      }

      if (transcription.trim()) {
        console.log(`"${transcription.trim()}"`);
        
        if (this.websocket) {
          this.websocket.send(JSON.stringify({
            type: 'transcription',
            text: transcription.trim(),
            timestamp: Date.now()
          }));
        }
        
        return transcription;
      }

    } catch (error) {
      console.error('Error processing VAD speech segment:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  private async processAccumulatedAudio() {
    if (this.isProcessing) return;
    
    this.isProcessing = true;

    try {
      const totalLength = this.audioBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
      const combinedAudio = new Float32Array(totalLength);
      
      let offset = 0;
      for (const chunk of this.audioBuffer) {
        combinedAudio.set(chunk, offset);
        offset += chunk.length;
      }

      // Save debug audio before sending to STT
      await this.saveAudioDebug(combinedAudio, 'fallback-combined');

      const outputStream = await this.executor.execute(
        {
          data: Array.from(combinedAudio),
          sampleRate: 16000,
        },
        uuidv4(),
      );

      let transcription = '';
      let chunk = await outputStream.next();
      console.log('++++ grabbing stream output ++++')
      console.log(chunk)

      while (!chunk.done) {
        console.log('++++ grabbing stream output ++++')
        console.log(chunk.type)
        if (chunk.data) {
          transcription += chunk.data;
        }
        chunk = await outputStream.next();
      }

      if (transcription.trim()) {
        console.log(`"${transcription.trim()}"`);
        
        if (this.websocket) {
          this.websocket.send(JSON.stringify({
            type: 'transcription',
            text: transcription.trim(),
            timestamp: Date.now()
          }));
        }
      }

      this.audioBuffer = [];

    } catch (error) {
      console.error('Error processing audio:', error);
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