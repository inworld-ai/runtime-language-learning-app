export class WebSocketClient {
    constructor(url) {
        this.url = url;
        this.ws = null;
        this.listeners = new Map();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
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
                
            case 'ai_response':
                this.emit('ai_response', {
                    text: message.data.text,
                    audio: message.data.audio
                });
                break;
                
            case 'flashcard_generated':
                this.emit('flashcard_generated', message.data);
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
                
            default:
                console.log('Unknown message type:', message.type);
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
        if (this.ws) {
            this.ws.close();
        }
    }
}