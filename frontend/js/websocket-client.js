export class WebSocketClient {
    constructor(url) {
        this.url = url;
        this.ws = null;
        this.listeners = new Map();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.pingInterval = null;
        
        // Check for iOS and use optimized URL if available
        this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                     (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        
        if (this.isIOS && window.iosAudioHandler) {
            const optimizedUrl = window.iosAudioHandler.getOptimizedWebSocketURL();
            if (optimizedUrl) {
                console.log('[WebSocketClient] Using iOS-optimized WebSocket URL:', optimizedUrl);
                this.url = optimizedUrl;
            }
        }
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
    
    async connect() {
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.url);
                
                this.ws.onopen = () => {
                    console.log('WebSocket connected');
                    this.reconnectAttempts = 0;
                    this.emit('connection', 'connected');
                    
                    // Start ping/pong for iOS to keep connection alive
                    if (this.isIOS) {
                        this.startPingPong();
                    }
                    
                    resolve();
                };
                
                this.ws.onmessage = (event) => {
                    try {
                        const message = JSON.parse(event.data);
                        this.handleMessage(message);
                    } catch (error) {
                        console.error('Failed to parse WebSocket message:', error);
                    }
                };
                
                this.ws.onclose = (event) => {
                    console.log('WebSocket disconnected:', event.code, event.reason);
                    this.emit('connection', 'disconnected');
                    
                    // Stop ping/pong
                    this.stopPingPong();
                    
                    if (!event.wasClean && this.reconnectAttempts < this.maxReconnectAttempts) {
                        this.scheduleReconnect();
                    }
                };
                
                this.ws.onerror = (error) => {
                    console.error('WebSocket error:', error);
                    this.emit('connection', 'disconnected');
                    reject(error);
                };
                
            } catch (error) {
                reject(error);
            }
        });
    }
    
    scheduleReconnect() {
        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        
        console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        
        setTimeout(() => {
            this.emit('connection', 'connecting');
            this.connect().catch(() => {
                if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                    console.error('Max reconnection attempts reached');
                    this.emit('connection', 'disconnected');
                }
            });
        }, delay);
    }
    
    handleMessage(message) {
        switch (message.type) {
            case 'transcript_update':
                this.emit('transcript_update', message.data.text);
                break;
                
            case 'transcription':
                this.emit('transcription', {
                    text: message.text,
                    timestamp: message.timestamp
                });
                break;
                
            case 'ai_response':
                this.emit('ai_response', {
                    text: message.data.text,
                    audio: message.data.audio
                });
                break;
                
            case 'flashcard_generated':
                this.emit('flashcard_generated', message.data);
                break;
                
            case 'flashcards_generated':
                this.emit('flashcards_generated', message.flashcards);
                break;
            case 'introduction_state_updated':
                this.emit('introduction_state_updated', message.introduction_state);
                break;
                
            case 'connection_status':
                // Connection status received
                break;
                
            case 'speech_detected':
                this.emit('speech_detected', message.data);
                break;
                
            case 'speech_ended':
                this.emit('speech_ended', message.data);
                break;
                
            case 'llm_response_chunk':
                this.emit('llm_response_chunk', {
                    text: message.text,
                    timestamp: message.timestamp
                });
                break;
                
            case 'llm_response_complete':
                this.emit('llm_response_complete', {
                    text: message.text,
                    timestamp: message.timestamp
                });
                break;
                
            case 'audio_stream':
                this.emit('audio_stream', {
                    audio: message.audio,
                    sampleRate: message.sampleRate,
                    timestamp: message.timestamp
                });
                break;
                
            case 'audio_stream_complete':
                this.emit('audio_stream_complete', {
                    timestamp: message.timestamp
                });
                break;

            case 'interrupt':
                this.emit('interrupt', { reason: message.reason });
                break;
                
            default:
                console.log('Unknown message type:', message.type);
        }
    }
    
    send(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
    }
    
    sendAudioChunk(audioData) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const message = {
                type: 'audio_chunk',
                audio_data: audioData
            };
            this.ws.send(JSON.stringify(message));
        }
    }
    
    disconnect() {
        this.stopPingPong();
        if (this.ws) {
            this.ws.close();
        }
    }
    
    startPingPong() {
        // Send ping every 30 seconds to keep connection alive on iOS
        this.pingInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.send({ type: 'ping' });
                console.log('[WebSocketClient] Ping sent to keep connection alive');
            }
        }, 30000);
    }
    
    stopPingPong() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }
}