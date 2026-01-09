import { useState, useCallback } from 'react';
import type { Flashcard as FlashcardType } from '../types';

interface FlashcardProps {
  flashcard: FlashcardType;
  onCardClick?: (flashcard: FlashcardType) => void;
  onPronounce?: (flashcard: FlashcardType) => void;
  isPronouncing?: boolean;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function Flashcard({
  flashcard,
  onCardClick,
  onPronounce,
  isPronouncing = false,
}: FlashcardProps) {
  const [isFlipped, setIsFlipped] = useState(false);

  const handleClick = useCallback(() => {
    setIsFlipped((prev) => !prev);
    onCardClick?.(flashcard);
  }, [flashcard, onCardClick]);

  const handlePronounce = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onPronounce?.(flashcard);
    },
    [flashcard, onPronounce]
  );

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
          <button
            className={`pronounce-button ${isPronouncing ? 'loading' : ''}`}
            onClick={handlePronounce}
            disabled={isPronouncing}
            aria-label="Pronounce word"
          >
            {isPronouncing ? (
              <svg
                className="pronounce-spinner"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
              </svg>
            )}
          </button>
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
