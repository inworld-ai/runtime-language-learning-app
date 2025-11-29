import { WebSocketClient } from './websocket-client.js';
import { AudioHandler } from './audio-handler.js';
import { AudioPlayer } from './audio-player.js';
import { ChatUI } from './chat-ui.js';
import { FlashcardUI } from './flashcard-ui.js';
import { Storage } from './storage.js';

class App {
  constructor() {
    this.storage = new Storage();
    this.wsClient = new WebSocketClient('ws://localhost:3000');
    this.audioHandler = new AudioHandler();
    this.audioPlayer = new AudioPlayer();
    this.chatUI = new ChatUI();
    this.flashcardUI = new FlashcardUI();
    this.userId = this.getOrCreateUserId();
    this.currentAudioElement = null; // Track current Audio element to prevent simultaneous playback
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
      lastPendingTranscription: null,
      speechDetected: false,
      llmResponseComplete: false, // Track if LLM response is complete to prevent chunk accumulation
      currentResponseId: null, // Track current response to match audio with text
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
    console.log(
      'Loading existing conversation history:',
      existingConversation.messages.length,
      'messages'
    );
    console.log(
      'Loading existing flashcards:',
      this.state.flashcards.length,
      'flashcards'
    );
  }

  saveState() {
    this.storage.saveState({
      chatHistory: this.state.chatHistory,
    });
    // Flashcards are saved separately through storage.addFlashcards()
  }

  setupEventListeners() {
    const micButton = document.getElementById('micButton');
    const restartButton = document.getElementById('restartButton');

    // Check for iOS
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    // Add both click and touch events for better iOS support
    micButton.addEventListener('click', (e) => {
      e.preventDefault();
      this.toggleStreaming();
    });

    if (isIOS) {
      // Add touch event for iOS
      micButton.addEventListener(
        'touchend',
        (e) => {
          e.preventDefault();
          this.toggleStreaming();
        },
        { passive: false }
      );

      // Prevent double-tap zoom on mic button
      let lastTouchEnd = 0;
      micButton.addEventListener(
        'touchend',
        (e) => {
          const now = Date.now();
          if (now - lastTouchEnd <= 300) {
            e.preventDefault();
          }
          lastTouchEnd = now;
        },
        false
      );
    }

    // Restart button event listener
    restartButton.addEventListener('click', (e) => {
      e.preventDefault();
      this.restartConversation();
    });

    if (isIOS) {
      restartButton.addEventListener(
        'touchend',
        (e) => {
          e.preventDefault();
          this.restartConversation();
        },
        { passive: false }
      );
    }

    this.wsClient.on('connection', (status) => {
      this.state.connectionStatus = status;

      // Send existing conversation history to backend when connected
      if (status === 'connected') {
        const existingConversation = this.storage.getConversationHistory();
        if (existingConversation.messages.length > 0) {
          console.log(
            'Sending existing conversation history to backend:',
            existingConversation.messages.length,
            'messages'
          );
          this.wsClient.send({
            type: 'conversation_update',
            data: existingConversation,
          });
        }
      }

      this.render();
    });

    this.wsClient.on('transcript_update', (text) => {
      this.state.currentTranscript = text;
      this.state.speechDetected = true; // Ensure speech detected is true when we get transcript
      this.render();
    });

    this.wsClient.on('ai_response', (response) => {
      this.addMessage('teacher', response.text);
      this.state.currentTranscript = '';
      this.state.speechDetected = false;
      // Note: ai_response is legacy - audio should come via audio_stream now
      // But if it does come, stop any current playback first
      if (response.audio) {
        this.audioPlayer.stop();
        // Convert WAV base64 to PCM and play through AudioPlayer
        // For now, use the legacy playAudio but stop current playback first
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
      // Show listening indicator immediately when VAD detects speech
      // Use empty string or placeholder - transcript will update as it arrives
      this.state.currentTranscript = data.text || '';
      this.state.speechDetected = true;
      
      // Trigger interrupt behavior immediately on VAD detection
      // This freezes the current response if one is streaming
      this.handleInterrupt();
      
      this.render();
    });

    this.wsClient.on('speech_ended', (data) => {
      // VAD stopped detecting speech - clear the real-time transcript bubble
      console.log('[Main] VAD stopped detecting speech, clearing real-time transcript');
      
      // Clear speech detected state to hide the real-time transcript bubble
      // Only clear if we don't have a pending transcription (which means speech was processed)
      // If we have a pending transcription, it will be handled by the transcription handler
      if (!this.state.pendingTranscription) {
        this.state.currentTranscript = '';
        this.state.speechDetected = false;
        this.render();
      }
    });

    this.wsClient.on('transcription', (data) => {
      // Stop any ongoing audio from previous response to prevent audio/text mismatch
      // A new transcription means a new conversation turn is starting
      this.audioPlayer.stop();
      if (this.currentAudioElement) {
        this.currentAudioElement.pause();
        this.currentAudioElement.src = '';
        this.currentAudioElement = null;
      }
      
      this.state.pendingTranscription = data.text;
      this.state.currentTranscript = '';
      this.state.speechDetected = false; // Clear speech detected when transcription is complete
      
      // If we have a frozen LLM response from an interrupt, finalize it now
      if (this.state.pendingLLMResponse && !this.state.streamingLLMResponse) {
        // We have a frozen response from an interrupt, finalize it with this transcription
        console.log('[Main] Finalizing frozen LLM response with new transcription');
        this.checkAndUpdateConversation();
      }
      
      // Before resetting LLM streaming, finalize any pending LLM response
      // This ensures the text is added to history even if typewriter was interrupted
      if (this.state.streamingLLMResponse && this.state.streamingLLMResponse.trim() && 
          this.state.llmResponseComplete && !this.state.pendingLLMResponse) {
        console.log('[Main] Finalizing LLM response before clearing streaming state');
        this.state.pendingLLMResponse = this.state.streamingLLMResponse;
        this.checkAndUpdateConversation();
      }
      
      // Reset LLM streaming for new conversation turn
      this.state.streamingLLMResponse = ''; // Reset LLM streaming for new conversation
      this.state.llmResponseComplete = false; // Reset completion flag for new response
      this.state.currentResponseId = null; // Reset response ID
      
      // Only render if the transcription changed to avoid restarting typewriter
      if (this.state.lastPendingTranscription !== data.text) {
        this.state.lastPendingTranscription = data.text;
        this.render();
      }
      
      // Check if we can update conversation (will happen if we just finalized a frozen response)
      this.checkAndUpdateConversation();
    });

    this.wsClient.on('llm_response_chunk', (data) => {
      // Only accumulate chunks if response is not yet complete
      // This prevents chunks from being added after llm_response_complete
      if (!this.state.llmResponseComplete) {
        this.state.streamingLLMResponse += data.text;
      } else {
        console.warn('[Main] Ignoring llm_response_chunk after response complete');
      }
    });

    this.wsClient.on('llm_response_complete', (data) => {
      console.log(
        '[Main] LLM response complete, starting typewriter with:',
        data.text
      );
      
      // Generate a unique ID for this response to match audio with text
      const responseId = `response_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      this.state.currentResponseId = responseId;
      
      // Mark response as complete to prevent further chunk accumulation
      this.state.llmResponseComplete = true;
      
      // Use the provided text (which should be the complete response)
      // This ensures we use the backend's final text, not accumulated chunks
      const finalText = data.text || this.state.streamingLLMResponse;
      this.state.streamingLLMResponse = finalText;
      
      console.log('[Main] About to render for typewriter effect');

      // Set up callback for when typewriter finishes
      this.chatUI.setLLMTypewriterCallback(() => {
        console.log('[Main] LLM typewriter finished, updating conversation');
        // Only update if this is still the current response (not interrupted)
        if (this.state.currentResponseId === responseId) {
          this.state.pendingLLMResponse = finalText;
          this.checkAndUpdateConversation();
        } else {
          console.log('[Main] Response was interrupted, skipping conversation update');
        }
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

    // Interrupt handling: stop audio playback and freeze current response
    // This is triggered both by 'interrupt' message and 'speech_detected' (VAD)
    this.wsClient.on('interrupt', (_data) => {
      console.log('[Main] Interrupt message received');
      this.handleInterrupt();
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
        this.wsClient.send({
          type: 'user_context',
          timezone: tz,
          userId: this.userId,
        });
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
        id =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `u_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
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
        this.state.currentTranscript = '';
        this.state.speechDetected = false;
      } catch (error) {
        console.error('Failed to start streaming:', error);
        alert(
          'Microphone access denied. Please enable microphone permissions.'
        );
        return;
      }
    } else {
      this.audioHandler.stopStreaming();
      this.state.isRecording = false;
      this.state.currentTranscript = '';
      this.state.speechDetected = false;
    }
    this.render();
  }

  restartConversation() {
    // Stop any ongoing recording
    if (this.state.isRecording) {
      this.audioHandler.stopStreaming();
      this.state.isRecording = false;
    }

    // Stop audio playback
    try {
      this.audioPlayer.stop();
    } catch (error) {
      console.error('Error stopping audio:', error);
    }

    // Clear conversation history from storage
    this.storage.clearConversation();

    // Clear chat history from state
    this.state.chatHistory = [];
    this.state.currentTranscript = '';
    this.state.currentLLMResponse = '';
    this.state.pendingTranscription = null;
    this.state.pendingLLMResponse = null;
    this.state.streamingLLMResponse = '';
    this.state.lastPendingTranscription = null;
    this.state.speechDetected = false;
    this.state.llmResponseComplete = false;
    this.state.currentResponseId = null;

    // Clear typewriters
    this.chatUI.clearAllTypewriters();

    // Save cleared state
    this.saveState();

    // Send restart message to backend
    if (this.wsClient && this.state.connectionStatus === 'connected') {
      this.wsClient.send({
        type: 'restart_conversation',
      });
    }

    // Re-render UI
    this.render();
  }

  checkAndUpdateConversation() {
    // Only proceed when we have both transcription and LLM response
    console.log(
      'checkAndUpdateConversation called - pending transcription:',
      this.state.pendingTranscription,
      'pending LLM:',
      this.state.pendingLLMResponse
    );

    if (this.state.pendingTranscription && this.state.pendingLLMResponse) {
      // Check if we've already added both messages together to prevent duplicates
      const lastUserMessage = this.state.chatHistory
        .filter((m) => m.role === 'learner')
        .pop();
      const lastTeacherMessage = this.state.chatHistory
        .filter((m) => m.role === 'teacher')
        .pop();

      // Check if both messages together are duplicates
      const isDuplicate =
        lastUserMessage?.content === this.state.pendingTranscription &&
        lastTeacherMessage?.content === this.state.pendingLLMResponse;

      if (isDuplicate) {
        console.log(
          '[Main] Duplicate conversation turn detected, skipping update'
        );
        // Still clear the pending state
        this.state.pendingTranscription = null;
        this.state.pendingLLMResponse = null;
        this.state.streamingLLMResponse = '';
        this.state.lastPendingTranscription = null;
        this.state.llmResponseComplete = false;
        return;
      }
      
      // Check if teacher message was already added (from interrupt) but user message wasn't
      // In this case, we just need to add the user message
      const teacherAlreadyAdded = lastTeacherMessage?.content === this.state.pendingLLMResponse;
      const userAlreadyAdded = lastUserMessage?.content === this.state.pendingTranscription;
      
      if (teacherAlreadyAdded && !userAlreadyAdded) {
        console.log('[Main] Teacher message already added from interrupt, adding user message');
        // Just add the user message
        this.storage.addMessage('user', this.state.pendingTranscription);
        this.addMessageToHistory('learner', this.state.pendingTranscription);
        
        // Send conversation update
        const conversationHistory = this.storage.getConversationHistory();
        this.wsClient.send({
          type: 'conversation_update',
          data: conversationHistory,
        });
        
        // Clear pending state
        this.state.pendingTranscription = null;
        this.state.pendingLLMResponse = null;
        this.state.streamingLLMResponse = '';
        this.state.lastPendingTranscription = null;
        this.state.llmResponseComplete = false;
        this.state.currentResponseId = null;
        
        this.render();
        return;
      }

      console.log('Adding messages to conversation history...');

      // Add both messages to conversation history (with automatic truncation)
      const userHistory = this.storage.addMessage(
        'user',
        this.state.pendingTranscription
      );
      const assistantHistory = this.storage.addMessage(
        'assistant',
        this.state.pendingLLMResponse
      );

      console.log(
        'User message added, total messages:',
        userHistory.messages.length
      );
      console.log(
        'Assistant message added, total messages:',
        assistantHistory.messages.length
      );

      // Add to chat history for display
      this.addMessageToHistory('learner', this.state.pendingTranscription);
      this.addMessageToHistory('teacher', this.state.pendingLLMResponse);

      // Get updated conversation history and send to backend
      const conversationHistory = this.storage.getConversationHistory();
      console.log(
        'Sending conversation update to backend:',
        conversationHistory.messages.length,
        'messages'
      );

      this.wsClient.send({
        type: 'conversation_update',
        data: conversationHistory,
      });

      // Clear pending messages and streaming state
      this.state.pendingTranscription = null;
      this.state.pendingLLMResponse = null;
      this.state.streamingLLMResponse = '';
      this.state.lastPendingTranscription = null;
      this.state.llmResponseComplete = false;
      this.state.currentResponseId = null;

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
    const exists = this.state.flashcards.some(
      (card) =>
        card.spanish === flashcard.spanish || card.word === flashcard.word
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
      flashcards: this.state.flashcards,
    };
  }

  handleInterrupt() {
    console.log('[Main] Handling interrupt - stopping audio and freezing current response');
    try {
      // Stop audio playback
      this.audioPlayer.stop();
      // Also stop any Audio element playback
      if (this.currentAudioElement) {
        this.currentAudioElement.pause();
        this.currentAudioElement.src = '';
        this.currentAudioElement = null;
      }
      
      // Freeze the current LLM response if there is one
      // This means finalizing it and adding it to chat history, but keeping it visible
      if (this.state.streamingLLMResponse && this.state.streamingLLMResponse.trim()) {
        console.log('[Main] Freezing current LLM response:', this.state.streamingLLMResponse);
        
        // Stop typewriter effect immediately
        this.chatUI.clearAllTypewriters();
        
        // Get the frozen text
        const frozenText = this.state.streamingLLMResponse;
        
        // Save the frozen response
        this.state.pendingLLMResponse = frozenText;
        
        // If we have a pending transcription, finalize the conversation turn now
        // Otherwise, we'll finalize it when the transcription arrives
        if (this.state.pendingTranscription) {
          // We have both, so we can finalize this conversation turn immediately
          // This adds both messages to chat history
          this.checkAndUpdateConversation();
        } else {
          // No transcription yet - add just the LLM response to chat history now
          // so it stays visible. We'll add the user message when transcription arrives.
          // Check if this message is already in history to avoid duplicates
          const lastTeacherMessage = this.state.chatHistory
            .filter((m) => m.role === 'teacher')
            .pop();
          
          if (lastTeacherMessage?.content !== frozenText) {
            console.log('[Main] Adding frozen LLM response to chat history');
            this.addMessageToHistory('teacher', frozenText);
          }
        }
        
        // Clear streaming state - this will remove the streaming element
        // But the message is now in chat history, so it will stay visible
        this.state.streamingLLMResponse = '';
        this.state.llmResponseComplete = false;
        this.state.currentResponseId = null;
      } else {
        // No streaming response, just clear state
        this.state.streamingLLMResponse = '';
        this.state.llmResponseComplete = false;
        this.state.currentResponseId = null;
      }
      
      // Render to update UI
      this.render();
    } catch (error) {
      console.warn('Error handling interrupt:', error);
    }
  }

  async handleAudioStream(data) {
    try {
      if (data.audio && data.audio.length > 0) {
        console.log(
          `Received audio stream: ${data.audio.length} bytes at ${data.sampleRate}Hz${data.text ? ` with text: "${data.text}"` : ''}`
        );
        await this.audioPlayer.addAudioStream(data.audio, data.sampleRate);
      }
    } catch (error) {
      console.error('Error handling audio stream:', error);
    }
  }

  playAudio(audioData) {
    // Stop any current AudioPlayer playback to prevent simultaneous audio
    this.audioPlayer.stop();
    
    // Stop any existing Audio element playback
    if (this.currentAudioElement) {
      try {
        this.currentAudioElement.pause();
        this.currentAudioElement.src = '';
        this.currentAudioElement = null;
      } catch (error) {
        console.warn('Error stopping previous audio element:', error);
      }
    }
    
    const audio = new Audio();
    this.currentAudioElement = audio;
    audio.src = `data:audio/wav;base64,${audioData}`;
    audio.play().catch(console.error);
    
    // Clean up when audio finishes
    audio.onended = () => {
      if (this.currentAudioElement === audio) {
        this.currentAudioElement = null;
      }
    };
    
    audio.onerror = () => {
      if (this.currentAudioElement === audio) {
        this.currentAudioElement = null;
      }
    };
  }

  render() {
    this.updateConnectionStatus();
    this.chatUI.render(
      this.state.chatHistory,
      this.state.currentTranscript,
      this.state.currentLLMResponse,
      this.state.pendingTranscription,
      this.state.streamingLLMResponse,
      this.state.isRecording,
      this.state.speechDetected
    );
    this.flashcardUI.render(this.state.flashcards);

    const micButton = document.getElementById('micButton');
    const restartButton = document.getElementById('restartButton');
    micButton.disabled = this.state.connectionStatus !== 'connected';
    micButton.classList.toggle('recording', this.state.isRecording);
    restartButton.disabled = this.state.connectionStatus !== 'connected';
  }

  updateConnectionStatus() {
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');

    statusDot.className = `status-dot ${this.state.connectionStatus}`;

    const statusMessages = {
      connecting: 'Connecting...',
      connected: 'Connected',
      disconnected: 'Disconnected',
    };

    statusText.textContent =
      statusMessages[this.state.connectionStatus] || 'Unknown';
  }
}

new App();
