export class ChatUI {
    constructor() {
        this.messagesContainer = document.getElementById('messages');
        this.transcriptContainer = document.getElementById('currentTranscript');
        this.typewriterTimers = new Map(); // Track active typewriter effects
        this.typewriterSpeed = 25; // milliseconds per character
        this.llmTypewriterCallback = null; // Callback for when LLM typewriter completes
    }
    
    render(chatHistory, currentTranscript, currentLLMResponse, pendingTranscription, streamingLLMResponse) {
        this.renderMessages(chatHistory, pendingTranscription, streamingLLMResponse);
        this.renderCurrentTranscript(currentTranscript);
    }
    
    renderMessages(messages, pendingTranscription, streamingLLMResponse) {
        // Only clear and rebuild if the conversation history changed
        const currentHistoryLength = this.messagesContainer.querySelectorAll('.message:not(.streaming)').length;
        if (currentHistoryLength !== messages.length) {
            this.messagesContainer.innerHTML = '';
            
            // Render existing conversation history
            messages.forEach(message => {
                const messageElement = this.createMessageElement(message);
                this.messagesContainer.appendChild(messageElement);
            });
        }
        
        // Handle pending user transcription
        const existingUserStreaming = document.getElementById('pending-transcription');
        if (pendingTranscription) {
            if (!existingUserStreaming) {
                const userMessage = this.createMessageElement({
                    role: 'learner',
                    content: ''
                });
                userMessage.classList.add('streaming');
                userMessage.id = 'pending-transcription';
                this.messagesContainer.appendChild(userMessage);
                // Only start typewriter for new transcriptions
                this.startTypewriter('pending-transcription', pendingTranscription, this.typewriterSpeed * 0.8);
            }
            // Don't restart typewriter if element already exists
        } else if (existingUserStreaming) {
            existingUserStreaming.remove();
            this.clearTypewriter('pending-transcription');
        }
        
        // Handle streaming LLM response
        const existingLLMStreaming = document.getElementById('streaming-llm-response');
        if (streamingLLMResponse) {
            console.log('[ChatUI] Handling streaming LLM response:', streamingLLMResponse);
            if (!existingLLMStreaming) {
                console.log('[ChatUI] Creating new streaming LLM element and starting typewriter');
                const assistantMessage = this.createStreamingMessageElement('');
                assistantMessage.id = 'streaming-llm-response';
                this.messagesContainer.appendChild(assistantMessage);
                // Only start typewriter for new LLM responses
                this.startTypewriter('streaming-llm-response', streamingLLMResponse, this.typewriterSpeed, this.llmTypewriterCallback);
            }
            // Don't restart typewriter if element already exists
        } else if (existingLLMStreaming) {
            console.log('[ChatUI] Removing existing LLM streaming element');
            existingLLMStreaming.remove();
            this.clearTypewriter('streaming-llm-response');
        }
        
        this.scrollToBottom();
    }
    
    createMessageElement(message) {
        const div = document.createElement('div');
        div.className = `message ${message.role}`;
        div.textContent = message.content;
        return div;
    }
    
    createStreamingMessageElement(content) {
        const div = document.createElement('div');
        div.className = 'message teacher streaming';
        
        // Create text node for content
        const textNode = document.createTextNode(content);
        div.appendChild(textNode);
        
        // Add typing indicator
        const cursor = document.createElement('span');
        cursor.className = 'streaming-cursor';
        cursor.textContent = '▊';
        div.appendChild(cursor);
        
        return div;
    }
    
    renderCurrentTranscript(transcript) {
        if (transcript) {
            this.transcriptContainer.textContent = transcript;
        } else {
            this.transcriptContainer.textContent = '';
        }
    }
    
    startTypewriter(elementId, fullText, speed, onComplete) {
        const element = document.getElementById(elementId);
        if (!element) return;
        
        // Clear any existing timer for this element
        if (this.typewriterTimers.has(elementId)) {
            const existingTimer = this.typewriterTimers.get(elementId);
            clearInterval(existingTimer.timer || existingTimer);
            this.typewriterTimers.delete(elementId);
        }
        
        // Get the text content node (accounting for streaming cursor)
        const textContent = element.querySelector('.streaming-cursor') ? 
            element.childNodes[0] : element;
        
        // Start fresh - clear the content and start typing from beginning
        textContent.textContent = '';
        let currentIndex = 0;
        
        console.log(`[Typewriter] Starting ${elementId}, target: "${fullText}"`);
        
        const timer = setInterval(() => {
            if (currentIndex < fullText.length) {
                const newText = fullText.substring(0, currentIndex + 1);
                textContent.textContent = newText;
                currentIndex++;
                this.scrollToBottom();
            } else {
                console.log(`[Typewriter] Complete: ${elementId}`);
                clearInterval(timer);
                this.typewriterTimers.delete(elementId);
                
                // Call completion callback if provided
                if (onComplete) {
                    onComplete();
                }
            }
        }, speed);
        
        this.typewriterTimers.set(elementId, { timer, fullText });
    }
    
    clearTypewriter(elementId) {
        if (this.typewriterTimers.has(elementId)) {
            const timerData = this.typewriterTimers.get(elementId);
            clearInterval(timerData.timer || timerData);
            this.typewriterTimers.delete(elementId);
        }
    }
    
    clearAllTypewriters() {
        this.typewriterTimers.forEach((timerData, elementId) => {
            clearInterval(timerData.timer || timerData);
        });
        this.typewriterTimers.clear();
    }
    
    setLLMTypewriterCallback(callback) {
        this.llmTypewriterCallback = callback;
    }
    
    scrollToBottom() {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }
}