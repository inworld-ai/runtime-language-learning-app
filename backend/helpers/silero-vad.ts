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
    minVolume: number;           // minimum RMS volume for speech (0.0-1.0)
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
    private isProcessingVAD = false;  // Prevent concurrent VAD calls
    
    // Simplified state tracking following working example pattern
    private isCapturingSpeech = false;
    private speechBuffer: number[] = [];
    private pauseDuration = 0;
    private readonly FRAME_PER_BUFFER = 1024;
    private readonly INPUT_SAMPLE_RATE = 16000;

    constructor(config: VADConfig) {
        super();
        this.config = config;
        this.audioBuffer = new AudioBuffer(20, config.sampleRate);
        
        // Listen to audio chunks from buffer
        this.audioBuffer.on('audioChunk', this.processAudioChunk.bind(this));
    }

    async initialize(): Promise<void> {
        if (this.isInitialized) {
            console.log('SileroVAD: Already initialized');
            return;
        }

        try {
            console.log('SileroVAD: Starting initialization with model path:', this.config.modelPath);
            
            // Try to find CUDA device
            const availableDevices = DeviceRegistry.getAvailableDevices();
            console.log('SileroVAD: Available devices:', availableDevices.map(d => d.getType()));
            
            const cudaDevice = availableDevices.find(
                (device) => device.getType() === DeviceType.CUDA
            );
            console.log('SileroVAD: Using CUDA device:', !!cudaDevice);

            // Create local VAD instance
            console.log('SileroVAD: Creating VAD instance...');
            this.vad = await VADFactory.createLocal({
                modelPath: this.config.modelPath,
                device: cudaDevice
            });

            this.isInitialized = true;
            console.log('SileroVAD: Initialization complete');
            
        } catch (error) {
            console.error('SileroVAD: Failed to initialize:', error);
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
            console.error('SileroVAD: Error processing audio data:', error);
        }
    }

    private calculateRMSVolume(audioData: Float32Array): number {
        let sumSquares = 0;
        for (let i = 0; i < audioData.length; i++) {
            sumSquares += audioData[i] * audioData[i];
        }
        return Math.sqrt(sumSquares / audioData.length);
    }

    reset(): void {
        // Reset all state when interruption occurs
        this.accumulatedSamples = [];
        this.isProcessingVAD = false;
        this.isCapturingSpeech = false;
        this.speechBuffer = [];
        this.pauseDuration = 0;
    }

    private async processAudioChunk(chunk: AudioChunk): Promise<void> {
        if (!this.isInitialized || !this.vad) {
            return;
        }

        // Skip if already processing to prevent concurrent VAD calls
        if (this.isProcessingVAD) {
            return;
        }

        // Accumulate samples until we have enough for VAD processing
        this.accumulatedSamples.push(chunk.data);
        
        // Process when we have enough samples (using FRAME_PER_BUFFER like working example)
        const totalSamples = this.accumulatedSamples.reduce((sum, arr) => sum + arr.length, 0);
        if (totalSamples >= this.FRAME_PER_BUFFER) {
            this.isProcessingVAD = true;  // Set flag before async operation
            try {
                // Combine accumulated samples
                const combinedAudio = new Float32Array(totalSamples);
                let offset = 0;
                for (const samples of this.accumulatedSamples) {
                    combinedAudio.set(samples, offset);
                    offset += samples.length;
                }

                // Calculate RMS volume for noise filtering
                const rmsVolume = this.calculateRMSVolume(combinedAudio);

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
                
                // Following working example: -1 = no voice activity, anything else = voice activity
                // Add volume filtering to the working pattern
                const hasVoiceActivity = (result !== -1) && (rmsVolume >= this.config.minVolume);
                
                // Process using simplified state machine from working example
                await this.processVADResult(hasVoiceActivity, integerArray, rmsVolume);
                
                // Clear accumulated samples
                this.accumulatedSamples = [];
                
            } catch (error) {
                console.error('VAD processing error:', error);
                this.accumulatedSamples = []; // Clear on error
            } finally {
                this.isProcessingVAD = false;  // Always reset flag
            }
        }
    }


    private async processVADResult(hasVoiceActivity: boolean, audioChunk: number[], volume: number): Promise<void> {
        // Following the working example pattern exactly
        if (this.isCapturingSpeech) {
            this.speechBuffer.push(...audioChunk);
            if (!hasVoiceActivity) {
                // Already capturing speech but new chunk has no voice activity
                this.pauseDuration += (audioChunk.length * 1000) / this.INPUT_SAMPLE_RATE; // ms
                
                if (this.pauseDuration > this.config.minSilenceDuration * 1000) { // Convert to ms
                    this.isCapturingSpeech = false;
                    
                    const speechDuration = (this.speechBuffer.length * 1000) / this.INPUT_SAMPLE_RATE; // ms
                    
                    if (speechDuration > this.config.minSpeechDuration * 1000) { // Convert to ms
                        await this.processCapturedSpeech();
                    }
                    
                    // Reset for next speech capture
                    this.speechBuffer = [];
                    this.pauseDuration = 0;
                }
            } else {
                // Already capturing speech and new chunk has voice activity
                this.pauseDuration = 0;
            }
        } else {
            if (hasVoiceActivity) {
                // Not capturing speech but new chunk has voice activity - start capturing
                this.isCapturingSpeech = true;
                this.speechBuffer = [...audioChunk]; // Start fresh
                this.pauseDuration = 0;
                
                this.emit('speechStart', { 
                    timestamp: Date.now() / 1000, 
                    volume 
                });
            }
            // Not capturing speech and new chunk has no voice activity - do nothing
        }
    }
    
    private async processCapturedSpeech(): Promise<void> {
        if (this.speechBuffer.length === 0) return;
        
        // Convert integer array back to Float32Array for processing
        const speechSegment = new Float32Array(this.speechBuffer.length);
        for (let i = 0; i < this.speechBuffer.length; i++) {
            speechSegment[i] = this.speechBuffer[i] / 32768.0; // Normalize back to [-1, 1]
        }
        
        const speechDuration = (this.speechBuffer.length * 1000) / this.INPUT_SAMPLE_RATE;
        
        this.emit('speechEnd', {
            timestamp: Date.now() / 1000,
            speechSegment,
            speechDuration: speechDuration / 1000, // Convert back to seconds
            samplesCount: this.speechBuffer.length
        });
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