import { EventEmitter } from 'events';

export interface AudioChunk {
    data: Float32Array;
    timestamp: number;
}

export interface AudioEvent {
    type: 'speech_start' | 'speech_end' | 'silence_start' | 'silence_end';
    timestamp: number;
    data?: any;
}

export class AudioBuffer extends EventEmitter {
    private buffer: Float32Array;
    private bufferSize: number;
    private writeIndex: number = 0;
    private sampleRate: number;
    private events: AudioEvent[] = [];

    constructor(bufferSeconds: number = 20, sampleRate: number = 16000) {
        super();
        this.sampleRate = sampleRate;
        this.bufferSize = Math.floor(bufferSeconds * sampleRate);
        this.buffer = new Float32Array(this.bufferSize);
    }

    addChunk(audioData: Float32Array): void {
        const chunkSize = audioData.length;
        const timestamp = Date.now() / 1000;

        // Add to circular buffer
        for (let i = 0; i < chunkSize; i++) {
            this.buffer[this.writeIndex] = audioData[i];
            this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
        }

        // Emit chunk for VAD processing
        this.emit('audioChunk', {
            data: audioData,
            timestamp
        } as AudioChunk);
    }

    extractSegment(startTimestamp: number, endTimestamp?: number): Float32Array | null {
        const now = Date.now() / 1000;
        const actualEndTime = endTimestamp || now;
        
        const duration = actualEndTime - startTimestamp;
        const sampleCount = Math.floor(duration * this.sampleRate);
        
        if (sampleCount > this.bufferSize || duration <= 0) {
            return null;
        }

        const samplesToGoBack = Math.floor((now - startTimestamp) * this.sampleRate);
        const startIndex = (this.writeIndex - samplesToGoBack + this.bufferSize) % this.bufferSize;
        const endIndex = (startIndex + sampleCount) % this.bufferSize;

        const segment = new Float32Array(sampleCount);

        if (startIndex <= endIndex) {
            // No wraparound
            segment.set(this.buffer.slice(startIndex, endIndex));
        } else {
            // Handle wraparound
            const firstPart = this.buffer.slice(startIndex);
            const secondPart = this.buffer.slice(0, endIndex);
            segment.set(firstPart);
            segment.set(secondPart, firstPart.length);
        }

        return segment;
    }

    addEvent(type: AudioEvent['type'], data?: any): void {
        const event: AudioEvent = {
            type,
            timestamp: Date.now() / 1000,
            data
        };
        
        this.events.push(event);
        
        // Keep only last 1000 events
        if (this.events.length > 1000) {
            this.events = this.events.slice(-1000);
        }
        
        this.emit('audioEvent', event);
    }

    getLatestEvent(type: AudioEvent['type']): AudioEvent | null {
        for (let i = this.events.length - 1; i >= 0; i--) {
            if (this.events[i].type === type) {
                return this.events[i];
            }
        }
        return null;
    }

    clear(): void {
        this.buffer.fill(0);
        this.writeIndex = 0;
        this.events = [];
    }
}