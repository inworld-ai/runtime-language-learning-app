import { useState, useCallback } from 'react';
import type { Flashcard as FlashcardType } from '../types';

interface FlashcardProps {
  flashcard: FlashcardType;
  onCardClick?: (flashcard: FlashcardType) => void;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function Flashcard({ flashcard, onCardClick }: FlashcardProps) {
  const [isFlipped, setIsFlipped] = useState(false);

  const handleClick = useCallback(() => {
    setIsFlipped((prev) => !prev);
    onCardClick?.(flashcard);
  }, [flashcard, onCardClick]);

  // Support both new 'targetWord' and legacy 'spanish' field
  const targetWord =
    flashcard.targetWord || flashcard.spanish || flashcard.word || '';
  const english = flashcard.english || flashcard.translation || '';
  const example = flashcard.example || flashcard.example_sentence || '';
  const mnemonic = flashcard.mnemonic || '';

  return (
    <div
      className={`flashcard ${isFlipped ? 'flipped' : ''}`}
      onClick={handleClick}
    >
      <div className="flashcard-inner">
        <div className="flashcard-front">
          <div
            className="flashcard-target-word"
            dangerouslySetInnerHTML={{ __html: escapeHtml(targetWord) }}
          />
        </div>
        <div className="flashcard-back">
          <div
            className="flashcard-english"
            dangerouslySetInnerHTML={{ __html: escapeHtml(english) }}
          />
          <div
            className="flashcard-example"
            dangerouslySetInnerHTML={{ __html: escapeHtml(example) }}
          />
          {mnemonic && (
            <div className="flashcard-mnemonic">
              <span className="mnemonic-label">Remember:</span>{' '}
              <span
                dangerouslySetInnerHTML={{ __html: escapeHtml(mnemonic) }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
