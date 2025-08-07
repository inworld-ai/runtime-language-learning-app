export class Storage {
    constructor() {
        this.storageKey = 'aprende-app-state';
        this.conversationKey = 'aprende-conversation-history';
    }
    
    saveState(state) {
        try {
            const serializedState = JSON.stringify(state);
            localStorage.setItem(this.storageKey, serializedState);
        } catch (error) {
            console.error('Failed to save state to localStorage:', error);
        }
    }
    
    getState() {
        try {
            const serializedState = localStorage.getItem(this.storageKey);
            if (serializedState === null) {
                return null;
            }
            return JSON.parse(serializedState);
        } catch (error) {
            console.error('Failed to load state from localStorage:', error);
            return null;
        }
    }
    
    clearState() {
        try {
            localStorage.removeItem(this.storageKey);
        } catch (error) {
            console.error('Failed to clear state from localStorage:', error);
        }
    }
    
    // Conversation history methods
    getConversationHistory() {
        try {
            const serializedHistory = localStorage.getItem(this.conversationKey);
            if (serializedHistory === null) {
                return { messages: [] };
            }
            return JSON.parse(serializedHistory);
        } catch (error) {
            console.error('Failed to load conversation history from localStorage:', error);
            return { messages: [] };
        }
    }
    
    addMessage(role, content) {
        const history = this.getConversationHistory();
        
        // Add new message with timestamp
        const message = {
            role: role,
            content: content,
            timestamp: new Date().toISOString()
        };
        
        history.messages.push(message);
        
        // Truncate to keep only last 40 turns (80 messages: 40 user + 40 assistant)
        if (history.messages.length > 80) {
            history.messages = history.messages.slice(-80);
        }
        
        // Save updated history
        try {
            const serializedHistory = JSON.stringify(history);
            localStorage.setItem(this.conversationKey, serializedHistory);
        } catch (error) {
            console.error('Failed to save conversation history to localStorage:', error);
        }
        
        return history;
    }
    
    clearConversation() {
        try {
            localStorage.removeItem(this.conversationKey);
        } catch (error) {
            console.error('Failed to clear conversation history from localStorage:', error);
        }
    }
}