export class ChatUI {
    constructor() {
        this.messagesContainer = document.getElementById('messages');
        this.transcriptContainer = document.getElementById('currentTranscript');
    }
    
    render(chatHistory, currentTranscript) {
        this.renderMessages(chatHistory);
        this.renderCurrentTranscript(currentTranscript);
    }
    
    renderMessages(messages) {
        this.messagesContainer.innerHTML = '';
        
        messages.forEach(message => {
            const messageElement = this.createMessageElement(message);
            this.messagesContainer.appendChild(messageElement);
        });
        
        this.scrollToBottom();
    }
    
    createMessageElement(message) {
        const div = document.createElement('div');
        div.className = `message ${message.role}`;
        div.textContent = message.content;
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