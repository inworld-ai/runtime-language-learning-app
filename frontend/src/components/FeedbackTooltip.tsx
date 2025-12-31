import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface FeedbackTooltipProps {
  feedback: string | null;
  visible: boolean;
  position: { x: number; y: number };
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export function FeedbackTooltip({
  feedback,
  visible,
  position,
  onMouseEnter,
  onMouseLeave,
}: FeedbackTooltipProps) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const isLoading = feedback === null;

  // Adjust position after content loads
  useEffect(() => {
    if (visible && tooltipRef.current && !isLoading) {
      const tooltipRect = tooltipRef.current.getBoundingClientRect();
      tooltipRef.current.style.top = `${position.y - tooltipRect.height}px`;
    }
  }, [visible, isLoading, position.y, feedback]);

  if (!visible) return null;

  const tooltipContent = (
    <div
      ref={tooltipRef}
      className={`feedback-tooltip ${visible ? 'visible' : ''} ${isLoading ? 'loading' : ''}`}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        maxWidth: '400px',
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="feedback-content">
        <span className="feedback-text">
          {isLoading ? '' : feedback || 'No feedback available'}
        </span>
      </div>
      <div className="feedback-loading">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
  );

  return createPortal(tooltipContent, document.body);
}
