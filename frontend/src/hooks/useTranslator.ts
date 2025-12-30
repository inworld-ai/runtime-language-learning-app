import { useState, useCallback, useRef } from 'react';
import { Translator } from '../services/Translator';

export function useTranslator() {
  const translatorRef = useRef(new Translator());
  const [translation, setTranslation] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const translate = useCallback(async (text: string) => {
    setIsLoading(true);
    try {
      const result = await translatorRef.current.translate(text, 'en', 'auto');
      setTranslation(result);
    } catch {
      setTranslation(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clearTranslation = useCallback(() => {
    setTranslation(null);
  }, []);

  return { translation, isLoading, translate, clearTranslation };
}
