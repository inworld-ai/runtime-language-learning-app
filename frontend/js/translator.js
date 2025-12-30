/**
 * Translation service using Google's free translation endpoint
 * No authentication required
 */
export class Translator {
  constructor() {
    this.cache = new Map();
    this.pendingRequests = new Map();
  }

  /**
   * Translate text to target language using Google's free endpoint
   * @param {string} text - Text to translate
   * @param {string} targetLang - Target language code (default: 'en')
   * @param {string} sourceLang - Source language code (default: 'auto' for auto-detect)
   * @returns {Promise<string>} - Translated text
   */
  async translate(text, targetLang = 'en', sourceLang = 'auto') {
    if (!text || !text.trim()) {
      return '';
    }

    const cacheKey = `${sourceLang}:${targetLang}:${text}`;
    
    // Check cache first
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    // Check if there's already a pending request for this text
    if (this.pendingRequests.has(cacheKey)) {
      return this.pendingRequests.get(cacheKey);
    }

    // Create the translation request
    const requestPromise = this._fetchTranslation(text, targetLang, sourceLang)
      .then(translation => {
        this.cache.set(cacheKey, translation);
        this.pendingRequests.delete(cacheKey);
        return translation;
      })
      .catch(error => {
        this.pendingRequests.delete(cacheKey);
        throw error;
      });

    this.pendingRequests.set(cacheKey, requestPromise);
    return requestPromise;
  }

  async _fetchTranslation(text, targetLang, sourceLang) {
    const encodedText = encodeURIComponent(text);
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodedText}`;

    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Translation failed: ${response.status}`);
      }

      const data = await response.json();
      
      // Google's response format: [[["translated text", "original text", ...], ...], ...]
      // We need to concatenate all translated segments
      if (data && data[0]) {
        const translatedParts = data[0]
          .filter(part => part && part[0])
          .map(part => part[0]);
        return translatedParts.join('');
      }

      throw new Error('Invalid translation response format');
    } catch (error) {
      console.error('[Translator] Translation error:', error);
      throw error;
    }
  }

  /**
   * Clear the translation cache
   */
  clearCache() {
    this.cache.clear();
  }
}

// Singleton instance
export const translator = new Translator();

