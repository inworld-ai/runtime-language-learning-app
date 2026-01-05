import { useState, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { Flashcard } from './Flashcard';
import type { Flashcard as FlashcardType } from '../types';

// Helper for API URL for Cloud Run deployment
const getApiUrl = (path: string): string => {
  const backendUrl = import.meta.env.VITE_BACKEND_URL;
  return backendUrl ? `${backendUrl}${path}` : path;
};

export function FlashcardsSection() {
  const { state, wsClient, pronounceWord } = useApp();
  const { flashcards, currentLanguage, pronouncingCardId } = state;
  const [isExporting, setIsExporting] = useState(false);

  const handleCardClick = useCallback(
    (card: FlashcardType) => {
      wsClient.send({ type: 'flashcard_clicked', card });
    },
    [wsClient]
  );

  const handlePronounce = useCallback(
    (card: FlashcardType) => {
      const targetWord = card.targetWord || card.spanish || card.word || '';
      if (!targetWord) return;

      pronounceWord(targetWord);
    },
    [pronounceWord]
  );

  const exportToAnki = useCallback(async () => {
    const validFlashcards = flashcards.filter((flashcard) => {
      const targetWord = flashcard.targetWord || flashcard.spanish;
      return (
        targetWord &&
        flashcard.english &&
        targetWord.trim() !== '' &&
        flashcard.english.trim() !== ''
      );
    });

    if (validFlashcards.length === 0) {
      alert('No valid flashcards to export');
      return;
    }

    setIsExporting(true);

    try {
      const languageNames: Record<string, string> = {
        es: 'Spanish',
        ja: 'Japanese',
        fr: 'French',
      };
      const languageName = languageNames[currentLanguage] || 'Language';

      const response = await fetch(getApiUrl('/api/export-anki'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          flashcards: validFlashcards,
          deckName: `Inworld Language Tutor ${languageName} Cards`,
          languageCode: currentLanguage,
        }),
      });

      if (!response.ok) {
        throw new Error('Export failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `inworld_language_tutor_${currentLanguage}_cards.apkg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      console.log('ANKI deck exported successfully!');
    } catch (error) {
      console.error('Error exporting to ANKI:', error);
      alert('Failed to export flashcards to ANKI');
    } finally {
      setIsExporting(false);
    }
  }, [flashcards, currentLanguage]);

  // Sort flashcards by timestamp (most recent first)
  const sortedFlashcards = [...flashcards].sort((a, b) => {
    const timeA = new Date(a.timestamp || 0).getTime();
    const timeB = new Date(b.timestamp || 0).getTime();
    return timeB - timeA;
  });

  const cardCount = flashcards.length;
  const canExport = cardCount >= 1;

  return (
    <section className="flashcards-section">
      <div className="section-header">
        <h2>Flashcards</h2>
        <span
          id="cardCount"
          className={`card-count ${canExport ? 'exportable' : ''}`}
          onClick={canExport && !isExporting ? exportToAnki : undefined}
          style={{
            cursor: canExport && !isExporting ? 'pointer' : 'default',
          }}
        >
          {isExporting
            ? 'Exporting...'
            : canExport
              ? `Export ${cardCount} card${cardCount !== 1 ? 's' : ''} to Anki`
              : `${cardCount} card${cardCount !== 1 ? 's' : ''}`}
        </span>
      </div>
      <div className="flashcards-container">
        <div className="flashcards-grid" id="flashcardsGrid">
          {sortedFlashcards.length === 0 ? (
            <div className="empty-state"></div>
          ) : (
            sortedFlashcards.map((flashcard, index) => {
              const cardId =
                flashcard.targetWord || flashcard.spanish || flashcard.word || '';
              return (
                <Flashcard
                  key={`card-${cardId || index}`}
                  flashcard={flashcard}
                  onCardClick={handleCardClick}
                  onPronounce={handlePronounce}
                  isPronouncing={pronouncingCardId === cardId}
                />
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
