// @ts-ignore - no type definitions available for anki-apkg-export
import AnkiExport from 'anki-apkg-export';
import { Flashcard } from './flashcard-processor.ts';

export class AnkiExporter {
  
  /**
   * Export flashcards to ANKI .apkg format
   */
  async exportFlashcards(
    flashcards: Flashcard[], 
    deckName: string = 'Aprendemo Spanish Cards'
  ): Promise<Buffer> {
    const apkg = new (AnkiExport as any).default(deckName);

    // Add each flashcard as a card
    flashcards.forEach(flashcard => {
      // Skip empty or error flashcards
      if (!flashcard.spanish || !flashcard.english || flashcard.spanish.trim() === '' || flashcard.english.trim() === '') {
        return;
      }

      const front = flashcard.spanish.trim();
      const back = this.formatCardBack(flashcard);

      // Add tags for organization
      const tags = ['aprendemo', 'spanish-learning'];
      if (flashcard.timestamp) {
        const date = new Date(flashcard.timestamp).toISOString().split('T')[0];
        tags.push(`created-${date}`);
      }

      apkg.addCard(front, back, { tags });
    });

    // Generate and return the .apkg file as Buffer
    const zipBuffer = await apkg.save();
    return zipBuffer;
  }

  /**
   * Format the back of the card with English, example, and mnemonic
   */
  private formatCardBack(flashcard: Flashcard): string {
    let back = `<div style="font-size: 18px; margin-bottom: 10px;">${this.escapeHtml(flashcard.english)}</div>`;
    
    if (flashcard.example && flashcard.example.trim()) {
      back += `<div style="font-size: 14px; color: #666; font-style: italic; margin: 10px 0; padding: 8px; background-color: #f5f5f5; border-left: 3px solid #2196F3;">${this.escapeHtml(flashcard.example)}</div>`;
    }
    
    if (flashcard.mnemonic && flashcard.mnemonic.trim()) {
      back += `<div style="font-size: 13px; color: #4CAF50; margin-top: 10px; padding: 8px; background-color: #e8f5e8; border-radius: 4px;"><strong>💡 Remember:</strong> ${this.escapeHtml(flashcard.mnemonic)}</div>`;
    }

    return back;
  }

  /**
   * Escape HTML characters to prevent XSS and formatting issues
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Count valid flashcards (ones that can be exported)
   */
  countValidFlashcards(flashcards: Flashcard[]): number {
    return flashcards.filter(flashcard => 
      flashcard.spanish && 
      flashcard.english && 
      flashcard.spanish.trim() !== '' && 
      flashcard.english.trim() !== ''
    ).length;
  }
}