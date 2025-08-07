import { EventEmitter } from 'events';
import { VADFactory } from '@inworld/runtime/primitives/vad';
import { DeviceRegistry, DeviceType } from '@inworld/runtime/core';
import { AudioBuffer, AudioChunk } from './audio-buffer.js';

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
    private silenceStartTimestamp: number | null = null;

    constructor(config: VADConfig) {
        super();
        this.config = config;
        this.audioBuffer = new AudioBuffer(20, config.sampleRate);
        
        // Listen to audio chunks from buffer
        this.audioBuffer.on('audioChunk', this.processAudioChunk.bind(this));
    }

    async initialize(): Promise<void> {
        if (this.isInitialized) return;

        try {
            // Try to find CUDA device
            const cudaDevice = DeviceRegistry.getAvailableDevices().find(
                (device) => device.getType() === DeviceType.CUDA
            );

            // Create local VAD instance
            this.vad = await VADFactory.createLocal({
                modelPath: this.config.modelPath,
                device: cudaDevice
            });

            this.isInitialized = true;
            
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

            // Convert to Int16Array then normalize to Float32 range [-1, 1]
            const int16Array = new Int16Array(bytes.buffer);
            
            // Convert to normalized Float32Array for consistent audio processing
            const normalizedArray = new Float32Array(int16Array.length);
            for (let i = 0; i < int16Array.length; i++) {
                normalizedArray[i] = int16Array[i] / 32768.0; // Normalize to [-1, 1] range
            }

            // Add to audio buffer with normalized Float32Array
            this.audioBuffer.addChunk(normalizedArray);
            
        } catch (error) {
            console.error('Error processing audio data:', error);
        }
    }

    private async processAudioChunk(chunk: AudioChunk): Promise<void> {
        if (!this.isInitialized || !this.vad) {
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

                // Convert normalized Float32Array back to integer array for VAD model
                const integerArray: number[] = [];
                for (let i = 0; i < combinedAudio.length; i++) {
                    // Convert back to Int16 range for VAD processing
                    integerArray.push(Math.round(combinedAudio[i] * 32768));
                }
                
                // Process with Silero VAD
                const result = await this.vad.detectVoiceActivity({
                    data: integerArray,
                    sampleRate: this.config.sampleRate
                });
                
                // Handle -1 as silence (insufficient data = no speech detected)
                let isSpeech = false;
                if (result === -1) {
                    isSpeech = false; // Treat as silence
                } else {
                    console.log('result', result);
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
            }
            
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
                        
                        // Extract audio with generous buffer for complete utterances
                        const bufferDuration = 2.0;  // Increased from 1.5s to 2.0s
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
    }
}