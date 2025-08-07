export class ChatUI {
    constructor() {
        this.messagesContainer = document.getElementById('messages');
        this.transcriptContainer = document.getElementById('currentTranscript');
    }
    
    render(chatHistory, currentTranscript, currentLLMResponse) {
        this.renderMessages(chatHistory, currentLLMResponse);
        this.renderCurrentTranscript(currentTranscript);
    }
    
    renderMessages(messages, currentLLMResponse) {
        this.messagesContainer.innerHTML = '';
        
        messages.forEach(message => {
            const messageElement = this.createMessageElement(message);
            this.messagesContainer.appendChild(messageElement);
        });
        
        // Show streaming LLM response if it exists
        if (currentLLMResponse && currentLLMResponse.trim()) {
            const streamingElement = this.createStreamingMessageElement(currentLLMResponse);
            this.messagesContainer.appendChild(streamingElement);
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
        div.textContent = content;
        
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
    
    scrollToBottom() {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }
}