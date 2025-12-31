import { useState, useRef, useCallback, useEffect } from 'react';
import type { ChatMessage } from '../types';
import { TranslationTooltip } from './TranslationTooltip';
import { FeedbackTooltip } from './FeedbackTooltip';
import { useApp } from '../context/AppContext';

interface MessageProps {
  message: ChatMessage;
}

export function Message({ message }: MessageProps) {
  const { state } = useApp();
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

  // Get feedback for learner messages from the feedbackMap
  const feedback =
    message.role === 'learner'
      ? (state.feedbackMap[message.content] ?? null)
      : null;

  return (
    <>
      <div
        ref={messageRef}
        className={`message ${message.role}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {message.content}
      </div>
      {message.role === 'teacher' && (
        <TranslationTooltip
          text={message.content}
          visible={showTooltip}
          position={tooltipPosition}
          onMouseEnter={handleTooltipMouseEnter}
          onMouseLeave={handleTooltipMouseLeave}
        />
      )}
      {message.role === 'learner' && (
        <FeedbackTooltip
          feedback={feedback}
          visible={showTooltip}
          position={tooltipPosition}
          onMouseEnter={handleTooltipMouseEnter}
          onMouseLeave={handleTooltipMouseLeave}
        />
      )}
    </>
  );
}
