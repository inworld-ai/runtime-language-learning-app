export class FlashcardUI {
    constructor() {
        this.flashcardsGrid = document.getElementById('flashcardsGrid');
        this.cardCount = document.getElementById('cardCount');
        this.flashcards = [];
    }
    
    render(flashcards) {
        this.flashcards = flashcards;
        this.updateCardCount(flashcards.length);
        this.renderFlashcards(flashcards);
    }
    
    addFlashcards(newFlashcards) {
        // Add new flashcards to the existing collection
        this.flashcards = [...this.flashcards, ...newFlashcards];
        this.render(this.flashcards);
    }
    
    updateCardCount(count) {
        this.cardCount.textContent = `${count} card${count !== 1 ? 's' : ''}`;
    }
    
    renderFlashcards(flashcards) {
        this.flashcardsGrid.innerHTML = '';
        
        if (flashcards.length === 0) {
            this.renderEmptyState();
            return;
        }
        
        // Show only the latest flashcards, scroll to see older ones
        const sortedFlashcards = [...flashcards].sort((a, b) => {
            const timeA = new Date(a.timestamp || 0).getTime();
            const timeB = new Date(b.timestamp || 0).getTime();
            return timeB - timeA; // Most recent first
        });
        
        sortedFlashcards.forEach(flashcard => {
            const cardElement = this.createFlashcardElement(flashcard);
            this.flashcardsGrid.appendChild(cardElement);
        });
    }
    
    renderEmptyState() {
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-state';
        emptyState.innerHTML = '';
        this.flashcardsGrid.appendChild(emptyState);
    }
    
    createFlashcardElement(flashcard) {
        const card = document.createElement('div');
        card.className = 'flashcard';
        
        card.innerHTML = `
            <div class="flashcard-inner">
                <div class="flashcard-front">
                    <div class="flashcard-spanish">${this.escapeHtml(flashcard.spanish || flashcard.word || '')}</div>
                </div>
                <div class="flashcard-back">
                    <div class="flashcard-english">${this.escapeHtml(flashcard.english || flashcard.translation || '')}</div>
                    <div class="flashcard-example">${this.escapeHtml(flashcard.example || flashcard.example_sentence || '')}</div>
                    <div class="flashcard-mnemonic">
                        <span class="mnemonic-label">Remember:</span>
                        ${this.escapeHtml(flashcard.mnemonic || '')}
                    </div>
                </div>
            </div>
        `;
        
        card.addEventListener('click', () => {
            this.flipCard(card);
        });
        
        return card;
    }
    
    flipCard(cardElement) {
        cardElement.classList.toggle('flipped');
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}