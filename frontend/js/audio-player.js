export class AudioPlayer {
    constructor() {
        this.audioContext = null;
        this.audioQueue = [];
        this.isPlaying = false;
        this.currentSource = null;
        this.sampleRate = 16000; // Default sample rate to match backend
        this.listeners = new Map();
    }
    
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
    }
    
    emit(event, data) {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            callbacks.forEach(callback => callback(data));
        }
    }
    
    async initialize() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Resume AudioContext if suspended
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
            
            console.log('Audio player initialized with sample rate:', this.audioContext.sampleRate);
        } catch (error) {
            console.error('Failed to initialize audio player:', error);
            throw error;
        }
    }
    
    async addAudioStream(base64Audio, sampleRate = 16000) {
        if (!this.audioContext) {
            await this.initialize();
        }
        
        if (!base64Audio || base64Audio.length === 0) {
            console.warn('Empty audio data received');
            return;
        }
        
        try {
            this.sampleRate = sampleRate;
            
            // Decode base64 to binary
            const binaryString = atob(base64Audio);
            const bytes = new Uint8Array(binaryString.length);
            
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            
            // Create audio buffer from the decoded data
            const audioBuffer = await this.createAudioBuffer(bytes.buffer, sampleRate);
            
            // Queue the audio buffer for playback
            this.audioQueue.push(audioBuffer);
            
            // Start playback if not already playing
            if (!this.isPlaying) {
                this.playNextBuffer();
            }
            
        } catch (error) {
            console.error('Error processing audio stream:', error);
        }
    }
    
    async createAudioBuffer(arrayBuffer, sampleRate) {
        try {
            // Try to decode as audio first (for formats like MP3, WAV, etc.)
            try {
                const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer.slice(0));
                return audioBuffer;
            } catch (decodeError) {
                console.log('Decoding as audio format failed, treating as raw PCM data');
                
                // Treat as raw PCM data (common for TTS output)
                const int16Array = new Int16Array(arrayBuffer);
                const audioBuffer = this.audioContext.createBuffer(1, int16Array.length, sampleRate);
                const channelData = audioBuffer.getChannelData(0);
                
                // Convert Int16 to Float32 and normalize
                for (let i = 0; i < int16Array.length; i++) {
                    channelData[i] = int16Array[i] / 32768.0;
                }
                
                return audioBuffer;
            }
        } catch (error) {
            console.error('Error creating audio buffer:', error);
            throw error;
        }
    }
    
    playNextBuffer() {
        if (this.audioQueue.length === 0) {
            this.isPlaying = false;
            this.emit('playback_finished');
            return;
        }
        
        const audioBuffer = this.audioQueue.shift();
        this.isPlaying = true;
        
        // Create buffer source
        this.currentSource = this.audioContext.createBufferSource();
        this.currentSource.buffer = audioBuffer;
        
        // Connect to destination
        this.currentSource.connect(this.audioContext.destination);
        
        // Set up event handlers
        this.currentSource.onended = () => {
            this.currentSource = null;
            // Play next buffer in queue
            this.playNextBuffer();
        };
        
        // Start playback
        this.currentSource.start(0);
        this.emit('playback_started');
        
        console.log(`Playing audio buffer: ${audioBuffer.duration.toFixed(2)}s`);
    }
    
    stop() {
        if (this.currentSource) {
            try {
                this.currentSource.stop();
                this.currentSource = null;
            } catch (error) {
                console.warn('Error stopping audio source:', error);
            }
        }
        
        // Clear the queue
        this.audioQueue = [];
        this.isPlaying = false;
        this.emit('playback_stopped');
    }
    
    destroy() {
        this.stop();
        
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        
        this.listeners.clear();
    }
    
    getQueueLength() {
        return this.audioQueue.length;
    }
    
    isPlaybackActive() {
        return this.isPlaying;
    }
}