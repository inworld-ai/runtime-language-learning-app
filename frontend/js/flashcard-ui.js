export class FlashcardUI {
    constructor() {
        this.flashcardsGrid = document.getElementById('flashcardsGrid');
        this.cardCount = document.getElementById('cardCount');
    }
    
    render(flashcards) {
        this.updateCardCount(flashcards.length);
        this.renderFlashcards(flashcards);
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
        
        flashcards.forEach(flashcard => {
            const cardElement = this.createFlashcardElement(flashcard);
            this.flashcardsGrid.appendChild(cardElement);
        });
    }
    
    renderEmptyState() {
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-state';
        emptyState.innerHTML = '<p>Start a conversation to generate flashcards</p>';
        this.flashcardsGrid.appendChild(emptyState);
    }
    
    createFlashcardElement(flashcard) {
        const card = document.createElement('div');
        card.className = 'flashcard';
        
        card.innerHTML = `
            <div class="flashcard-word">${this.escapeHtml(flashcard.word)}</div>
            <div class="flashcard-translation">${this.escapeHtml(flashcard.translation)}</div>
            <div class="flashcard-example">"${this.escapeHtml(flashcard.example_sentence)}"</div>
            <div class="flashcard-mnemonic">${this.escapeHtml(flashcard.mnemonic)}</div>
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