import { EventEmitter } from 'events';
import { VADFactory } from '@inworld/runtime/primitives/vad';
import { DeviceRegistry, DeviceType } from '@inworld/runtime/core';
import { AudioBuffer, AudioChunk, AudioEvent } from './audio-buffer.js';

export interface VADConfig {
    modelPath: string;
    threshold: number;
    minSpeechDuration: number;   // seconds
    minSilenceDuration: number;  // seconds
    speechResetSilenceDuration: number;  // grace period before resetting speech timer
    sampleRate: number;
}

export interface VADResult {
    isSpeech: boolean;
    confidence: number;
    timestamp: number;
}

export class SileroVAD extends EventEmitter {
    private vad: any = null;
    private config: VADConfig;
    private audioBuffer: AudioBuffer;
    private accumulatedSamples: Float32Array[] = [];
    private isInitialized = false;
    
    // Simple state tracking - following your sound logic
    private speechStartTimestamp: number | null = null;
    private lastSpeechTimestamp: number | null = null;
    private silenceStartTimestamp: number | null = null;

    constructor(config: VADConfig) {
        super();
        this.config = config;
        this.audioBuffer = new AudioBuffer(20, config.sampleRate);
        
        // Listen to audio chunks from buffer
        this.audioBuffer.on('audioChunk', this.processAudioChunk.bind(this));
        
        // Silero VAD initialized
    }

    async initialize(): Promise<void> {
        if (this.isInitialized) return;

        try {
            // Initializing Silero VAD
            
            // Try to find CUDA device
            const cudaDevice = DeviceRegistry.getAvailableDevices().find(
                (device) => device.getType() === DeviceType.CUDA
            );
            
            // Device selection complete

            // Create local VAD instance
            this.vad = await VADFactory.createLocal({
                modelPath: this.config.modelPath,
                device: cudaDevice
            });

            this.isInitialized = true;
            // Silero VAD ready
            
        } catch (error) {
            console.error('Failed to initialize Silero VAD:', error);
            throw error;
        }
    }

    addAudioData(base64Data: string): void {
        try {
            // Convert base64 to buffer (same as working example needs)
            const binaryString = Buffer.from(base64Data, 'base64').toString('binary');
            const bytes = new Uint8Array(binaryString.length);
            
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            // Convert to Int16Array but keep as integers (no normalization!)
            const int16Array = new Int16Array(bytes.buffer);
            
            // Convert to plain array of integers (like working example)
            const integerArray = new Float32Array(int16Array.length);
            for (let i = 0; i < int16Array.length; i++) {
                integerArray[i] = int16Array[i]; // Keep raw integer values for VAD
            }

            // Add to audio buffer (still Float32Array for buffer compatibility)
            this.audioBuffer.addChunk(integerArray);
            
        } catch (error) {
            console.error('Error processing audio data:', error);
        }
    }

    private async processAudioChunk(chunk: AudioChunk): Promise<void> {
        if (!this.isInitialized || !this.vad) {
            // console.log(`⚠️ Skipping VAD processing - initialized: ${this.isInitialized}, vad: ${!!this.vad}`);
            return;
        }

        // Accumulate samples until we have enough for VAD processing
        this.accumulatedSamples.push(chunk.data);
        
        // Process when we have enough samples (try larger chunks to help with -1 results)
        const totalSamples = this.accumulatedSamples.reduce((sum, arr) => sum + arr.length, 0);
        if (totalSamples >= 1024) {  // Try larger chunks since -1 might mean insufficient data
            try {
                // Combine accumulated samples
                const combinedAudio = new Float32Array(totalSamples);
                let offset = 0;
                for (const samples of this.accumulatedSamples) {
                    combinedAudio.set(samples, offset);
                    offset += samples.length;
                }

                // Let VAD model make the speech/silence decision - it's working well

                // Convert Float32Array to plain array of integers (like working example)
                const integerArray: number[] = [];
                for (let i = 0; i < combinedAudio.length; i++) {
                    integerArray.push(combinedAudio[i]); // Raw integer values
                }
                
                // Process with Silero VAD using working example format
                const result = await this.vad.detectVoiceActivity({
                    data: integerArray,  // Plain array, not Float32Array!
                    sampleRate: this.config.sampleRate
                });
                
                // Handle -1 as silence (insufficient data = no speech detected)
                let isSpeech = false;
                if (result === -1) {
                    isSpeech = false; // Treat as silence
                } else {
                    isSpeech = result > this.config.threshold;
                }
                
                const vadResult: VADResult = {
                    isSpeech,
                    confidence: result,
                    timestamp: chunk.timestamp
                };

                // Emit VAD result
                this.emit('vadResult', vadResult);

                // Process speech/silence state changes
                await this.processVADResult(vadResult);
                
                // Clear accumulated samples
                this.accumulatedSamples = [];
                
            } catch (error) {
                console.error('VAD processing error:', error);
                this.accumulatedSamples = []; // Clear on error
            }
        }
    }


    private async processVADResult(result: VADResult): Promise<void> {
        const now = result.timestamp;

        if (result.isSpeech) {
            // Speech detected - note the timestamp
            if (this.speechStartTimestamp === null) {
                // First speech detection - mark start
                this.speechStartTimestamp = now;
                this.audioBuffer.addEvent('speech_start', { confidence: result.confidence });
                this.emit('speechStart', { timestamp: now, confidence: result.confidence });
                // Speech started
            }
            
            // Update last speech timestamp (for tracking continuous speech)
            this.lastSpeechTimestamp = now;
            
            // Reset silence tracking since we have speech
            this.silenceStartTimestamp = null;
            
        } else {
            // No speech detected
            if (this.speechStartTimestamp !== null) {
                // We had speech before, now checking for silence
                if (this.silenceStartTimestamp === null) {
                    // First silence after speech - mark start of silence
                    this.silenceStartTimestamp = now;
                } else {
                    // Check if we have unbroken silence for threshold duration
                    const silenceDuration = now - this.silenceStartTimestamp;
                    
                    if (silenceDuration >= this.config.minSilenceDuration) {
                        // We have enough silence - extract speech segment with buffer and send to STT
                        const speechDuration = this.silenceStartTimestamp - this.speechStartTimestamp;
                        const totalDuration = now - this.speechStartTimestamp;
                        
                        // Speech complete, processing
                        
                        // Extract audio with 0.5s buffer on each side for better context
                        const bufferDuration = 1.5;
                        const extractStart = this.speechStartTimestamp - bufferDuration;
                        const extractEnd = this.silenceStartTimestamp + bufferDuration;
                        
                        const speechSegment = this.audioBuffer.extractSegment(
                            extractStart,
                            extractEnd
                        );
                        
                        if (speechSegment) {
                            const actualExtractedDuration = extractEnd - extractStart;
                            
                            this.audioBuffer.addEvent('speech_end', { 
                                speechDuration,
                                silenceDuration,
                                totalDuration,
                                extractedDuration: actualExtractedDuration,
                                bufferDuration
                            });
                            
                            this.emit('speechEnd', {
                                timestamp: now,
                                speechSegment,
                                speechStart: extractStart,  // Use buffered start
                                speechDuration: actualExtractedDuration,  // Use actual extracted duration
                                silenceDuration
                            });
                        }
                        
                        // Reset state for next speech detection
                        this.speechStartTimestamp = null;
                        this.lastSpeechTimestamp = null;
                        this.silenceStartTimestamp = null;
                    }
                }
            }
        }
    }

    destroy(): void {
        if (this.vad) {
            this.vad.destroy();
            this.vad = null;
        }
        
        this.audioBuffer.clear();
        this.isInitialized = false;
        
        // Silero VAD destroyed
    }
}