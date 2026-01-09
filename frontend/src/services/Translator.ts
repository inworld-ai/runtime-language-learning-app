export class Translator {
  private cache = new Map<string, string>();
  private pendingRequests = new Map<string, Promise<string>>();

  async translate(
    text: string,
    targetLang: string = 'en',
    sourceLang: string = 'auto'
  ): Promise<string> {
    if (!text || !text.trim()) {
      return '';
    }

    const cacheKey = `${sourceLang}:${targetLang}:${text}`;

    // Check cache first
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    // Check if there's already a pending request
    if (this.pendingRequests.has(cacheKey)) {
      return this.pendingRequests.get(cacheKey)!;
    }

    // Create the translation request
    const requestPromise = this.fetchTranslation(text, targetLang, sourceLang)
      .then((translation) => {
        this.cache.set(cacheKey, translation);
        this.pendingRequests.delete(cacheKey);
        return translation;
      })
      .catch((error) => {
        this.pendingRequests.delete(cacheKey);
        throw error;
      });

    this.pendingRequests.set(cacheKey, requestPromise);
    return requestPromise;
  }

  private async fetchTranslation(
    text: string,
    targetLang: string,
    sourceLang: string
  ): Promise<string> {
    const encodedText = encodeURIComponent(text);
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodedText}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Translation failed: ${response.status}`);
      }

      const data = await response.json();

      // Google's response format: [[["translated text", "original text", ...], ...], ...]
      if (data && data[0]) {
        const translatedParts = data[0]
          .filter((part: unknown[]) => part && part[0])
          .map((part: unknown[]) => part[0]);
        return translatedParts.join('');
      }

      throw new Error('Invalid translation response format');
    } catch (error) {
      console.error('[Translator] Translation error:', error);
      throw error;
    }
  }

  clearCache(): void {
    this.cache.clear();
  }
}
