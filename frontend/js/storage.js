export class Storage {
    constructor() {
        this.storageKey = 'aprende-app-state';
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
}