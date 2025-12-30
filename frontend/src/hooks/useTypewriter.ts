import { useState, useEffect, useRef } from 'react';

interface UseTypewriterOptions {
  speed?: number;
  onComplete?: () => void;
  onContentUpdate?: () => void;
}

export function useTypewriter(
  text: string,
  options: UseTypewriterOptions = {}
) {
  const { speed = 25, onComplete, onContentUpdate } = options;
  const [displayedText, setDisplayedText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const onCompleteRef = useRef(onComplete);
  const onContentUpdateRef = useRef(onContentUpdate);
  const hasCompletedRef = useRef(false);

  // Keep callback refs up to date
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    onContentUpdateRef.current = onContentUpdate;
  }, [onContentUpdate]);

  useEffect(() => {
    if (!text) {
      setDisplayedText('');
      setIsTyping(false);
      hasCompletedRef.current = false;
      return;
    }

    setIsTyping(true);
    hasCompletedRef.current = false;
    let index = 0;

    const timer = setInterval(() => {
      if (index < text.length) {
        setDisplayedText(text.substring(0, index + 1));
        index++;
        // Notify parent of content update for scrolling
        onContentUpdateRef.current?.();
      } else {
        clearInterval(timer);
        setIsTyping(false);
        if (!hasCompletedRef.current) {
          hasCompletedRef.current = true;
          onCompleteRef.current?.();
        }
      }
    }, speed);

    return () => {
      clearInterval(timer);
    };
  }, [text, speed]);

  return { displayedText, isTyping };
}
