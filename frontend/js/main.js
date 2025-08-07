import { WebSocketClient } from './websocket-client.js';
import { AudioHandler } from './audio-handler.js';
import { ChatUI } from './chat-ui.js';
import { FlashcardUI } from './flashcard-ui.js';
import { Storage } from './storage.js';

class App {
    constructor() {
        this.storage = new Storage();
        this.wsClient = new WebSocketClient('ws://localhost:3001');
        this.audioHandler = new AudioHandler();
        this.chatUI = new ChatUI();
        this.flashcardUI = new FlashcardUI();
        
        this.state = {
            chatHistory: [],
            flashcards: [],
            isRecording: false,
            connectionStatus: 'connecting',
            currentTranscript: ''
        };
        
        this.init();
    }
    
    async init() {
        this.loadState();
        this.setupEventListeners();
        await this.connectWebSocket();
        this.render();
    }
    
    loadState() {
        const savedState = this.storage.getState();
        if (savedState) {
            this.state.chatHistory = savedState.chatHistory || [];
            this.state.flashcards = savedState.flashcards || [];
        }
    }
    
    saveState() {
        this.storage.saveState({
            chatHistory: this.state.chatHistory,
            flashcards: this.state.flashcards
        });
    }
    
    setupEventListeners() {
        const micButton = document.getElementById('micButton');
        micButton.addEventListener('click', () => {
            this.toggleStreaming();
        });
        
        this.wsClient.on('connection', (status) => {
            this.state.connectionStatus = status;
            this.render();
        });
        
        this.wsClient.on('transcript_update', (text) => {
            this.state.currentTranscript = text;
            this.render();
        });
        
        this.wsClient.on('ai_response', (response) => {
            this.addMessage('teacher', response.text);
            this.state.currentTranscript = '';
            if (response.audio) {
                this.playAudio(response.audio);
            }
        });
        
        this.wsClient.on('flashcard_generated', (flashcard) => {
            this.addFlashcard(flashcard);
        });
        
        this.wsClient.on('speech_detected', (data) => {
            this.state.currentTranscript = data.text || 'Speaking...';
            this.render();
        });
        
        this.wsClient.on('speech_ended', (data) => {
            if (data.text) {
                this.addMessage('learner', data.text);
            }
            this.state.currentTranscript = 'Processing...';
            this.render();
        });
        
        this.wsClient.on('transcription', (data) => {
            this.addMessage('learner', data.text);
            this.state.currentTranscript = '';
            this.render();
        });
        
        this.audioHandler.on('audioChunk', (audioData) => {
            this.wsClient.sendAudioChunk(audioData);
        });
    }
    
    async connectWebSocket() {
        try {
            await this.wsClient.connect();
        } catch (error) {
            console.error('WebSocket connection failed:', error);
            this.state.connectionStatus = 'disconnected';
            this.render();
        }
    }
    
    async toggleStreaming() {
        if (!this.state.isRecording) {
            try {
                await this.audioHandler.startStreaming();
                this.state.isRecording = true;
                this.state.currentTranscript = 'Listening...';
            } catch (error) {
                console.error('Failed to start streaming:', error);
                alert('Microphone access denied. Please enable microphone permissions.');
                return;
            }
        } else {
            this.audioHandler.stopStreaming();
            this.state.isRecording = false;
            this.state.currentTranscript = '';
        }
        this.render();
    }
    
    addMessage(role, content) {
        const message = { role, content };
        this.state.chatHistory.push(message);
        this.saveState();
        this.render();
    }
    
    addFlashcard(flashcard) {
        const exists = this.state.flashcards.some(card => 
            card.word === flashcard.word
        );
        
        if (!exists) {
            this.state.flashcards.push(flashcard);
            this.saveState();
            this.render();
        }
    }
    
    getContextForBackend() {
        return {
            chatHistory: this.state.chatHistory.slice(-10),
            flashcards: this.state.flashcards
        };
    }
    
    playAudio(audioData) {
        const audio = new Audio();
        audio.src = `data:audio/wav;base64,${audioData}`;
        audio.play().catch(console.error);
    }
    
    render() {
        this.updateConnectionStatus();
        this.chatUI.render(this.state.chatHistory, this.state.currentTranscript);
        this.flashcardUI.render(this.state.flashcards);
        
        const micButton = document.getElementById('micButton');
        micButton.disabled = this.state.connectionStatus !== 'connected';
        micButton.classList.toggle('recording', this.state.isRecording);
    }
    
    updateConnectionStatus() {
        const statusDot = document.getElementById('statusDot');
        const statusText = document.getElementById('statusText');
        
        statusDot.className = `status-dot ${this.state.connectionStatus}`;
        
        const statusMessages = {
            connecting: 'Connecting...',
            connected: 'Connected',
            disconnected: 'Disconnected'
        };
        
        statusText.textContent = statusMessages[this.state.connectionStatus] || 'Unknown';
    }
}

new App();