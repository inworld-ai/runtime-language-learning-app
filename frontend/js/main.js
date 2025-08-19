import { WebSocketClient } from './websocket-client.js';
import { AudioHandler } from './audio-handler.js';
import { AudioPlayer } from './audio-player.js';
import { ChatUI } from './chat-ui.js';
import { FlashcardUI } from './flashcard-ui.js';
import { Storage } from './storage.js';

class App {
    constructor() {
        this.storage = new Storage();
        this.wsClient = new WebSocketClient('ws://localhost:3001');
        this.audioHandler = new AudioHandler();
        this.audioPlayer = new AudioPlayer();
        this.chatUI = new ChatUI();
        this.flashcardUI = new FlashcardUI();
        this.userId = this.getOrCreateUserId();
        this.flashcardUI.onCardClick = (card) => {
            this.wsClient.send({ type: 'flashcard_clicked', card });
        };
        
        this.state = {
            chatHistory: [],
            flashcards: [],
            isRecording: false,
            connectionStatus: 'connecting',
            currentTranscript: '',
            currentLLMResponse: '',
            pendingTranscription: null,
            pendingLLMResponse: null,
            streamingLLMResponse: '',
            lastPendingTranscription: null
        };
        
        this.init();
    }
    
    async init() {
        this.loadState();
        this.setupEventListeners();
        await this.connectWebSocket();
        await this.initializeAudioPlayer();
        this.render();
    }
    
    async initializeAudioPlayer() {
        try {
            await this.audioPlayer.initialize();
            console.log('Audio player initialized');
        } catch (error) {
            console.error('Failed to initialize audio player:', error);
        }
    }
    
    loadState() {
        const savedState = this.storage.getState();
        if (savedState) {
            this.state.chatHistory = savedState.chatHistory || [];
        }
        
        // Load flashcards from storage
        this.state.flashcards = this.storage.getFlashcards();
        
        // Load existing conversation history
        const existingConversation = this.storage.getConversationHistory();
        console.log('Loading existing conversation history:', existingConversation.messages.length, 'messages');
        console.log('Loading existing flashcards:', this.state.flashcards.length, 'flashcards');
    }
    
    saveState() {
        this.storage.saveState({
            chatHistory: this.state.chatHistory
        });
        // Flashcards are saved separately through storage.addFlashcards()
    }
    
    setupEventListeners() {
        const micButton = document.getElementById('micButton');
        
        // Check for iOS
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                     (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        
        // Add both click and touch events for better iOS support
        micButton.addEventListener('click', (e) => {
            e.preventDefault();
            this.toggleStreaming();
        });
        
        if (isIOS) {
            // Add touch event for iOS
            micButton.addEventListener('touchend', (e) => {
                e.preventDefault();
                this.toggleStreaming();
            }, { passive: false });
            
            // Prevent double-tap zoom on mic button
            let lastTouchEnd = 0;
            micButton.addEventListener('touchend', (e) => {
                const now = Date.now();
                if (now - lastTouchEnd <= 300) {
                    e.preventDefault();
                }
                lastTouchEnd = now;
            }, false);
        }
        
        this.wsClient.on('connection', (status) => {
            this.state.connectionStatus = status;
            
            // Send existing conversation history to backend when connected
            if (status === 'connected') {
                const existingConversation = this.storage.getConversationHistory();
                if (existingConversation.messages.length > 0) {
                    console.log('Sending existing conversation history to backend:', existingConversation.messages.length, 'messages');
                    this.wsClient.send({
                        type: 'conversation_update',
                        data: existingConversation
                    });
                }
            }
            
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
        
        this.wsClient.on('flashcards_generated', (flashcards) => {
            console.log('Received new flashcards:', flashcards);
            this.addMultipleFlashcards(flashcards);
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
            this.state.pendingTranscription = data.text;
            this.state.currentTranscript = '';
            this.state.streamingLLMResponse = ''; // Reset LLM streaming for new conversation
            // Only render if the transcription changed to avoid restarting typewriter
            if (this.state.lastPendingTranscription !== data.text) {
                this.state.lastPendingTranscription = data.text;
                this.render();
            }
            this.checkAndUpdateConversation();
        });
        
        this.wsClient.on('llm_response_chunk', (data) => {
            // Just accumulate the chunks, don't render yet
            this.state.streamingLLMResponse += data.text;
        });
        
        this.wsClient.on('llm_response_complete', (data) => {
            console.log('[Main] LLM response complete, starting typewriter with:', data.text);
            // Start the typewriter effect with the complete text
            this.state.streamingLLMResponse = data.text; // Set the complete text for typewriter
            console.log('[Main] About to render for typewriter effect');
            
            // Set up callback for when typewriter finishes
            this.chatUI.setLLMTypewriterCallback(() => {
                console.log('[Main] LLM typewriter finished, updating conversation');
                this.state.pendingLLMResponse = data.text;
                this.checkAndUpdateConversation();
            });
            
            this.render(); // Start typewriter effect
        });
        
        this.wsClient.on('audio_stream', (data) => {
            this.handleAudioStream(data);
        });
        
        this.wsClient.on('audio_stream_complete', (data) => {
            console.log('Audio stream complete signal received');
            this.audioPlayer.markStreamComplete();
        });

        // Minimal interruption handling: stop audio playback immediately
        this.wsClient.on('interrupt', (_data) => {
            console.log('[Main] Interrupt received, stopping audio playback');
            try { this.audioPlayer.stop(); } catch (_) {}
        });
        
        this.audioHandler.on('audioChunk', (audioData) => {
            this.wsClient.sendAudioChunk(audioData);
        });
        
        this.audioPlayer.on('playback_started', () => {
            console.log('Audio playback started');
        });
        
        this.audioPlayer.on('playback_finished', () => {
            console.log('Audio playback finished');
        });
    }
    
    async connectWebSocket() {
        try {
            await this.wsClient.connect();
            // After connection, send lightweight user context (timezone)
            try {
                const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
                this.wsClient.send({ type: 'user_context', timezone: tz, userId: this.userId });
            } catch (e) {
                // ignore
            }
        } catch (error) {
            console.error('WebSocket connection failed:', error);
            this.state.connectionStatus = 'disconnected';
            this.render();
        }
    }

    getOrCreateUserId() {
        try {
            const key = 'aprende-user-id';
            let id = localStorage.getItem(key);
            if (!id) {
                id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `u_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
                localStorage.setItem(key, id);
            }
            return id;
        } catch (_) {
            return `u_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
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
    
    checkAndUpdateConversation() {
        // Only proceed when we have both transcription and LLM response
        console.log('checkAndUpdateConversation called - pending transcription:', this.state.pendingTranscription, 'pending LLM:', this.state.pendingLLMResponse);
        
        if (this.state.pendingTranscription && this.state.pendingLLMResponse) {
            console.log('Adding messages to conversation history...');
            
            // Add both messages to conversation history (with automatic truncation)
            const userHistory = this.storage.addMessage('user', this.state.pendingTranscription);
            const assistantHistory = this.storage.addMessage('assistant', this.state.pendingLLMResponse);
            
            console.log('User message added, total messages:', userHistory.messages.length);
            console.log('Assistant message added, total messages:', assistantHistory.messages.length);
            
            // Add to chat history for display
            this.addMessageToHistory('learner', this.state.pendingTranscription);
            this.addMessageToHistory('teacher', this.state.pendingLLMResponse);
            
            // Get updated conversation history and send to backend
            const conversationHistory = this.storage.getConversationHistory();
            console.log('Sending conversation update to backend:', conversationHistory.messages.length, 'messages');
            
            this.wsClient.send({
                type: 'conversation_update',
                data: conversationHistory
            });
            
            // Clear pending messages and streaming state
            this.state.pendingTranscription = null;
            this.state.pendingLLMResponse = null;
            this.state.streamingLLMResponse = '';
            this.state.lastPendingTranscription = null;
            
            // Clear any active typewriters before rendering final state
            this.chatUI.clearAllTypewriters();
            this.render();
        }
    }
    
    addMessage(role, content) {
        // This method is kept for backward compatibility with existing addMessage calls
        this.addMessageToHistory(role, content);
    }
    
    addMessageToHistory(role, content) {
        const message = { role, content };
        this.state.chatHistory.push(message);
        this.saveState();
        this.render();
    }
    
    addFlashcard(flashcard) {
        const exists = this.state.flashcards.some(card => 
            (card.spanish === flashcard.spanish) || (card.word === flashcard.word)
        );
        
        if (!exists) {
            this.state.flashcards.push(flashcard);
            this.storage.addFlashcards([flashcard]);
            this.saveState();
            this.render();
        }
    }
    
    addMultipleFlashcards(flashcards) {
        // Use storage method which handles deduplication and persistence
        const updatedFlashcards = this.storage.addFlashcards(flashcards);
        this.state.flashcards = updatedFlashcards;
        this.saveState();
        this.render();
    }
    
    getContextForBackend() {
        return {
            chatHistory: this.state.chatHistory.slice(-10),
            flashcards: this.state.flashcards
        };
    }
    

    
    async handleAudioStream(data) {
        try {
            if (data.audio && data.audio.length > 0) {
                console.log(`Received audio stream: ${data.audio.length} bytes at ${data.sampleRate}Hz${data.text ? ` with text: "${data.text}"` : ''}`);
                await this.audioPlayer.addAudioStream(data.audio, data.sampleRate);
            }
        } catch (error) {
            console.error('Error handling audio stream:', error);
        }
    }
    
    playAudio(audioData) {
        const audio = new Audio();
        audio.src = `data:audio/wav;base64,${audioData}`;
        audio.play().catch(console.error);
    }
    
    render() {
        this.updateConnectionStatus();
        this.chatUI.render(
            this.state.chatHistory, 
            this.state.currentTranscript, 
            this.state.currentLLMResponse,
            this.state.pendingTranscription,
            this.state.streamingLLMResponse
        );
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