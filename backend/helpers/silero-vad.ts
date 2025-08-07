import { EventEmitter } from 'events';
import { VADFactory } from '@inworld/runtime/primitives/vad';
import { DeviceRegistry, DeviceType } from '@inworld/runtime/core';
import { AudioBuffer, AudioChunk, AudioEvent } from './audio-buffer.js';

export interface VADConfig {
    modelPath: string;
    threshold: number;
    minSpeechDuration: number;   // seconds
    minSilenceDuration: number;  // seconds
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
    private isInitialized = false;
    
    // State tracking
    private currentSpeechStart: number | null = null;
    private currentSilenceStart: number | null = null;
    private isSpeechActive = false;

    constructor(config: VADConfig) {
        super();
        this.config = config;
        this.audioBuffer = new AudioBuffer(20, config.sampleRate);
        
        // Listen to audio chunks from buffer
        this.audioBuffer.on('audioChunk', this.processAudioChunk.bind(this));
        
        console.log(`Silero VAD initialized with threshold ${config.threshold}`);
    }

    async initialize(): Promise<void> {
        if (this.isInitialized) return;

        try {
            console.log('Initializing Silero VAD...');
            
            // Try to find CUDA device
            const cudaDevice = DeviceRegistry.getAvailableDevices().find(
                (device) => device.getType() === DeviceType.CUDA
            );
            
            if (cudaDevice) {
                console.log('Using CUDA device for VAD');
            } else {
                console.log('Using CPU device for VAD');
            }

            // Create local VAD instance
            this.vad = await VADFactory.createLocal({
                modelPath: this.config.modelPath,
                device: cudaDevice
            });

            this.isInitialized = true;
            console.log('Silero VAD ready');
            
        } catch (error) {
            console.error('Failed to initialize Silero VAD:', error);
            throw error;
        }
    }

    addAudioData(base64Data: string): void {
        try {
            // Convert base64 to buffer
            const binaryString = Buffer.from(base64Data, 'base64').toString('binary');
            const bytes = new Uint8Array(binaryString.length);
            
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            // Convert Int16Array to Float32Array
            const int16Array = new Int16Array(bytes.buffer);
            const floatArray = new Float32Array(int16Array.length);
            
            for (let i = 0; i < int16Array.length; i++) {
                floatArray[i] = int16Array[i] / 32768.0; // Normalize to [-1, 1]
            }

            // Add to audio buffer
            this.audioBuffer.addChunk(floatArray);
            
        } catch (error) {
            console.error('Error processing audio data:', error);
        }
    }

    private async processAudioChunk(chunk: AudioChunk): Promise<void> {
        if (!this.isInitialized || !this.vad) return;

        try {
            // Process with Silero VAD
            const result = await this.vad.detectVoiceActivity({
                data: chunk.data,
                sampleRate: this.config.sampleRate
            });

            const isSpeech = result > this.config.threshold;
            const vadResult: VADResult = {
                isSpeech,
                confidence: result,
                timestamp: chunk.timestamp
            };

            // Emit VAD result
            this.emit('vadResult', vadResult);

            // Process speech/silence state changes
            await this.processVADResult(vadResult);
            
        } catch (error) {
            console.error('VAD processing error:', error);
        }
    }

    private async processVADResult(result: VADResult): Promise<void> {
        const now = result.timestamp;

        if (result.isSpeech) {
            // Speech detected
            if (!this.isSpeechActive) {
                // Start of speech
                this.currentSpeechStart = now;
                this.currentSilenceStart = null;
                this.isSpeechActive = true;
                
                this.audioBuffer.addEvent('speech_start', { confidence: result.confidence });
                this.emit('speechStart', { timestamp: now, confidence: result.confidence });
                
                console.log(`Speech started (confidence: ${result.confidence.toFixed(3)})`);
            }
            
        } else {
            // Silence detected
            if (this.isSpeechActive) {
                // Start tracking silence
                if (this.currentSilenceStart === null) {
                    this.currentSilenceStart = now;
                    this.audioBuffer.addEvent('silence_start');
                    
                } else {
                    // Check if we've had enough silence
                    const silenceDuration = now - this.currentSilenceStart;
                    
                    if (silenceDuration >= this.config.minSilenceDuration) {
                        // End of speech
                        const speechDuration = this.currentSilenceStart - (this.currentSpeechStart || now);
                        
                        // Only process if speech was long enough
                        if (speechDuration >= this.config.minSpeechDuration) {
                            console.log(`Speech ended after ${speechDuration.toFixed(2)}s (${silenceDuration.toFixed(2)}s silence)`);
                            
                            // Extract the speech segment
                            const speechSegment = this.audioBuffer.extractSegment(
                                this.currentSpeechStart!,
                                this.currentSilenceStart
                            );
                            
                            if (speechSegment) {
                                this.audioBuffer.addEvent('speech_end', { 
                                    duration: speechDuration,
                                    silenceDuration 
                                });
                                
                                this.emit('speechEnd', {
                                    timestamp: now,
                                    speechSegment,
                                    speechStart: this.currentSpeechStart,
                                    speechDuration,
                                    silenceDuration
                                });
                            }
                        } else {
                            console.log(`Speech too short (${speechDuration.toFixed(2)}s), ignoring`);
                        }
                        
                        // Reset state
                        this.isSpeechActive = false;
                        this.currentSpeechStart = null;
                        this.currentSilenceStart = null;
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
        
        console.log('Silero VAD destroyed');
    }
}