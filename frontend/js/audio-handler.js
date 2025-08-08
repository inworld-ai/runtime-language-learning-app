export class AudioHandler {
    constructor() {
        this.audioContext = null;
        this.workletNode = null;
        this.scriptProcessor = null;
        this.stream = null;
        this.microphone = null;
        this.isStreaming = false;
        this.listeners = new Map();
        
        // Check for iOS and use iOS handler if available
        this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                     (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        this.iosHandler = window.iosAudioHandler || null;
        
        if (this.isIOS && this.iosHandler) {
            console.log('[AudioHandler] Using iOS audio workarounds');
            this.setupIOSEventListeners();
        }
    }
    
    setupIOSEventListeners() {
        // Listen for iOS audio unlock event
        window.addEventListener('ios-audio-unlocked', (event) => {
            console.log('[AudioHandler] iOS audio unlocked');
            this.audioContext = event.detail.audioContext;
        });
        
        // Listen for iOS audio errors
        window.addEventListener('ios-audio-error', (event) => {
            console.error('[AudioHandler] iOS audio error:', event.detail.message);
            this.emit('error', event.detail);
        });
        
        // Listen for iOS audio ended
        window.addEventListener('ios-audio-ended', () => {
            console.log('[AudioHandler] iOS audio playback ended');
            this.emit('playback_finished');
        });
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
    
    async startStreaming() {
        try {
            console.log('Starting continuous audio streaming...');
            
            // Use iOS handler if available
            if (this.isIOS && this.iosHandler) {
                console.log('[AudioHandler] Using iOS audio handler for microphone');
                
                // First unlock audio context if needed
                await this.iosHandler.unlockAudioContext();
                
                // Start microphone with iOS workarounds
                const success = await this.iosHandler.startMicrophone((audioData) => {
                    if (this.isStreaming) {
                        this.emit('audioChunk', audioData);
                    }
                });
                
                if (success) {
                    this.isStreaming = true;
                    console.log('[AudioHandler] iOS microphone started successfully');
                    return;
                }
            }
            
            // Fallback to standard implementation
            const constraints = {
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 16000,
                    channelCount: 1
                }
            };

            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            console.log('Microphone access granted for continuous streaming');

            // Create AudioContext for real-time processing
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 16000
            });

            // Resume AudioContext if suspended (required on many browsers)
            if (this.audioContext.state === 'suspended') {
                console.log('Audio context suspended, resuming...');
                await this.audioContext.resume();
            }

            this.microphone = this.audioContext.createMediaStreamSource(this.stream);

            // Try AudioWorklet first, fallback to ScriptProcessorNode for iOS
            if (this.audioContext.audioWorklet) {
                console.log('Setting up AudioWorklet processor...');
                await this.setupAudioWorklet();
            } else {
                console.log('AudioWorklet not supported, using ScriptProcessorNode...');
                this.setupScriptProcessorNode();
            }

            this.isStreaming = true;
            console.log('Continuous audio streaming started');
            
        } catch (error) {
            console.error('Error starting continuous audio:', error);
            throw error;
        }
    }
    
    async setupAudioWorklet() {
        const workletCode = `
            class AudioProcessor extends AudioWorkletProcessor {
                process(inputs) {
                    const inputChannel = inputs[0][0];
                    if (!inputChannel) return true;
                    
                    // Convert Float32Array to Int16Array
                    const int16Array = new Int16Array(inputChannel.length);
                    for (let i = 0; i < inputChannel.length; i++) {
                        int16Array[i] = Math.max(-32768, Math.min(32767, inputChannel[i] * 32768));
                    }
                    
                    this.port.postMessage(int16Array.buffer, [int16Array.buffer]);
                    return true;
                }
            }
            registerProcessor('audio-processor', AudioProcessor);
        `;

        try {
            const blob = new Blob([workletCode], { type: 'application/javascript' });
            const workletURL = URL.createObjectURL(blob);
            await this.audioContext.audioWorklet.addModule(workletURL);
            console.log('AudioWorklet processor loaded');

            this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-processor');

            this.workletNode.port.onmessage = (event) => {
                if (this.isStreaming) {
                    const int16Buffer = event.data;
                    const base64Audio = btoa(
                        String.fromCharCode(...new Uint8Array(int16Buffer))
                    );
                    this.emit('audioChunk', base64Audio);
                }
            };

            // Connect the audio pipeline
            this.microphone.connect(this.workletNode);
            this.workletNode.connect(this.audioContext.destination);
            
        } catch (error) {
            console.error('Error loading AudioWorklet processor:', error);
            this.setupScriptProcessorNode();
        }
    }

    setupScriptProcessorNode() {
        console.log('Setting up ScriptProcessorNode for compatibility...');
        
        const bufferSize = 4096;
        this.scriptProcessor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

        this.scriptProcessor.onaudioprocess = (event) => {
            if (this.isStreaming) {
                const inputBuffer = event.inputBuffer;
                const inputData = inputBuffer.getChannelData(0);
                
                // Convert Float32Array to Int16Array
                const int16Array = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    int16Array[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
                }

                const base64Audio = btoa(
                    String.fromCharCode(...new Uint8Array(int16Array.buffer))
                );
                this.emit('audioChunk', base64Audio);
            }
        };

        // Connect the audio pipeline
        this.microphone.connect(this.scriptProcessor);
        this.scriptProcessor.connect(this.audioContext.destination);
    }
    
    stopStreaming() {
        console.log('Stopping continuous audio streaming...');
        this.isStreaming = false;

        // Use iOS handler if available
        if (this.isIOS && this.iosHandler) {
            this.iosHandler.stopMicrophone();
            console.log('[AudioHandler] iOS microphone stopped');
            return;
        }

        // Standard cleanup
        if (this.workletNode) {
            this.workletNode.port.onmessage = null;
            this.workletNode.disconnect();
            this.workletNode = null;
        }

        if (this.scriptProcessor) {
            this.scriptProcessor.onaudioprocess = null;
            this.scriptProcessor.disconnect();
            this.scriptProcessor = null;
        }

        if (this.microphone) {
            this.microphone.disconnect();
            this.microphone = null;
        }

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }

        console.log('Continuous audio streaming stopped');
    }
}