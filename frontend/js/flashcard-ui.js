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
    if (count >= 1) {
      this.cardCount.textContent = `Export ${count} card${count !== 1 ? 's' : ''} to Anki`;
      this.cardCount.style.cursor = 'pointer';
      this.cardCount.style.color = '#666';
      this.cardCount.style.textDecoration = 'underline';
      this.cardCount.onclick = () => this.exportToAnki();
    } else {
      this.cardCount.textContent = `${count} card${count !== 1 ? 's' : ''}`;
      this.cardCount.style.cursor = 'default';
      this.cardCount.style.color = 'inherit';
      this.cardCount.style.textDecoration = 'none';
      this.cardCount.onclick = null;
    }
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

    sortedFlashcards.forEach((flashcard) => {
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
      if (typeof this.onCardClick === 'function') {
        this.onCardClick(flashcard);
      }
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

  async exportToAnki() {
    try {
      // Filter out invalid flashcards
      const validFlashcards = this.flashcards.filter(
        (flashcard) =>
          flashcard.spanish &&
          flashcard.english &&
          flashcard.spanish.trim() !== '' &&
          flashcard.english.trim() !== ''
      );

      if (validFlashcards.length === 0) {
        alert('No valid flashcards to export');
        return;
      }

      // Show loading state
      const originalText = this.cardCount.textContent;
      this.cardCount.textContent = 'Exporting...';
      this.cardCount.style.cursor = 'wait';

      const response = await fetch('/api/export-anki', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          flashcards: validFlashcards,
          deckName: 'Aprendemo Spanish Cards',
        }),
      });

      if (!response.ok) {
        throw new Error('Export failed');
      }

      // Create download link
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'aprendemo_cards.apkg';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      console.log('ANKI deck exported successfully!');

      // Restore original state
      this.updateCardCount(this.flashcards.length);
    } catch (error) {
      console.error('Error exporting to ANKI:', error);
      alert('Failed to export flashcards to ANKI');

      // Restore original state
      this.updateCardCount(this.flashcards.length);
    }
  }
}
