import { useState, useRef, useCallback, useEffect } from 'react';
import { useTypewriter } from '../hooks/useTypewriter';
import { TranslationTooltip } from './TranslationTooltip';

interface StreamingMessageProps {
  text: string;
  onComplete?: () => void;
  onContentUpdate?: () => void;
}

export function StreamingMessage({ text, onComplete, onContentUpdate }: StreamingMessageProps) {
  const { displayedText, isTyping } = useTypewriter(text, {
    speed: 25,
    onComplete,
    onContentUpdate,
  });

  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const messageRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }

    hoverTimeoutRef.current = setTimeout(() => {
      if (messageRef.current) {
        const rect = messageRef.current.getBoundingClientRect();
        setTooltipPosition({
          x: rect.left + window.scrollX,
          y: rect.top + window.scrollY - 8,
        });
        setShowTooltip(true);
      }
    }, 300);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }

    hideTimeoutRef.current = setTimeout(() => {
      setShowTooltip(false);
    }, 150);
  }, []);

  const handleTooltipMouseEnter = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  const handleTooltipMouseLeave = useCallback(() => {
    setShowTooltip(false);
  }, []);

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, []);

  // Get text for translation (remove cursor)
  const textForTranslation = displayedText.replace('▊', '').trim();

  return (
    <>
      <div
        ref={messageRef}
        className="message teacher streaming"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {displayedText}
        {isTyping && <span className="streaming-cursor">▊</span>}
      </div>
      <TranslationTooltip
        text={textForTranslation}
        visible={showTooltip}
        position={tooltipPosition}
        onMouseEnter={handleTooltipMouseEnter}
        onMouseLeave={handleTooltipMouseLeave}
      />
    </>
  );
}
