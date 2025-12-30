import { translator } from './translator.js';

export class ChatUI {
  constructor() {
    this.messagesContainer = document.getElementById('messages');
    this.transcriptContainer = document.getElementById('currentTranscript');
    this.typewriterTimers = new Map(); // Track active typewriter effects
    this.typewriterSpeed = 25; // milliseconds per character
    this.llmTypewriterCallback = null; // Callback for when LLM typewriter completes
    
    // Translation tooltip
    this.translationTooltip = this._createTranslationTooltip();
    this.activeHoverElement = null;
    this.hoverTimeout = null;
    this.hideTimeout = null;
  }

  _createTranslationTooltip() {
    const tooltip = document.createElement('div');
    tooltip.className = 'translation-tooltip';
    tooltip.innerHTML = `
      <div class="translation-content">
        <span class="translation-text"></span>
      </div>
      <div class="translation-loading">
        <span></span><span></span><span></span>
      </div>
    `;
    document.body.appendChild(tooltip);
    
    // Keep tooltip visible when hovering over it
    tooltip.addEventListener('mouseenter', () => {
      if (this.hideTimeout) {
        clearTimeout(this.hideTimeout);
        this.hideTimeout = null;
      }
    });
    
    tooltip.addEventListener('mouseleave', () => {
      this._hideTooltip();
    });
    
    return tooltip;
  }

  _showTooltip(element, text) {
    const rect = element.getBoundingClientRect();
    const tooltip = this.translationTooltip;
    
    // Position tooltip above the message
    tooltip.style.left = `${rect.left + window.scrollX}px`;
    tooltip.style.top = `${rect.top + window.scrollY - 8}px`;
    tooltip.style.maxWidth = `${Math.min(rect.width + 40, 400)}px`;
    
    // Show loading state
    tooltip.classList.add('visible', 'loading');
    tooltip.querySelector('.translation-text').textContent = '';
    
    // Fetch translation
    translator.translate(text, 'en', 'auto')
      .then(translation => {
        if (this.activeHoverElement === element) {
          tooltip.querySelector('.translation-text').textContent = translation;
          tooltip.classList.remove('loading');
          
          // Reposition after content loads (in case size changed)
          requestAnimationFrame(() => {
            const tooltipRect = tooltip.getBoundingClientRect();
            tooltip.style.top = `${rect.top + window.scrollY - tooltipRect.height - 8}px`;
          });
        }
      })
      .catch(error => {
        console.error('[ChatUI] Translation failed:', error);
        if (this.activeHoverElement === element) {
          tooltip.querySelector('.translation-text').textContent = 'Translation unavailable';
          tooltip.classList.remove('loading');
        }
      });
  }

  _hideTooltip() {
    this.translationTooltip.classList.remove('visible', 'loading');
    this.activeHoverElement = null;
  }

  _setupTranslationHover(element) {
    element.addEventListener('mouseenter', () => {
      if (this.hideTimeout) {
        clearTimeout(this.hideTimeout);
        this.hideTimeout = null;
      }
      
      // Small delay before showing tooltip to avoid flickering
      this.hoverTimeout = setTimeout(() => {
        this.activeHoverElement = element;
        const text = element.textContent.replace('▊', '').trim(); // Remove cursor
        if (text) {
          this._showTooltip(element, text);
        }
      }, 300);
    });

    element.addEventListener('mouseleave', () => {
      if (this.hoverTimeout) {
        clearTimeout(this.hoverTimeout);
        this.hoverTimeout = null;
      }
      
      // Delay hiding to allow moving to tooltip
      this.hideTimeout = setTimeout(() => {
        this._hideTooltip();
      }, 150);
    });
  }

  render(
    chatHistory,
    currentTranscript,
    currentLLMResponse,
    pendingTranscription,
    streamingLLMResponse,
    isRecording,
    speechDetected
  ) {
    this.renderMessages(
      chatHistory,
      pendingTranscription,
      streamingLLMResponse,
      currentTranscript,
      isRecording,
      speechDetected
    );
    this.renderCurrentTranscript(currentTranscript);
  }

  renderMessages(
    messages,
    pendingTranscription,
    streamingLLMResponse,
    currentTranscript,
    isRecording,
    speechDetected
  ) {
    // Only clear and rebuild if the conversation history changed
    const currentHistoryLength = this.messagesContainer.querySelectorAll(
      '.message:not(.streaming)'
    ).length;
    if (currentHistoryLength !== messages.length) {
      this.messagesContainer.innerHTML = '';

      // Render existing conversation history
      messages.forEach((message) => {
        const messageElement = this.createMessageElement(message);
        this.messagesContainer.appendChild(messageElement);
      });
    }

    // Handle real-time transcript updates (while recording and speech detected)
    // Show immediately when VAD activates, even before transcript text arrives
    const existingRealtimeTranscript = document.getElementById(
      'realtime-transcript'
    );
    if (speechDetected && isRecording && !pendingTranscription) {
      if (!existingRealtimeTranscript) {
        const userMessage = this.createRealtimeTranscriptElement();
        userMessage.id = 'realtime-transcript';
        this.messagesContainer.appendChild(userMessage);
      }
      // Update the transcript in real-time (no typewriter effect)
      // Show 3-dot loading animation if no text yet, otherwise show the actual transcript
      const transcriptElement = document.getElementById('realtime-transcript');
      if (transcriptElement) {
        const textNode = transcriptElement.querySelector('.transcript-text');
        const loadingDots = transcriptElement.querySelector('.loading-dots');
        if (currentTranscript) {
          if (textNode) textNode.textContent = currentTranscript;
          if (loadingDots) loadingDots.style.display = 'none';
        } else {
          if (textNode) textNode.textContent = '';
          if (loadingDots) loadingDots.style.display = 'flex';
        }
        this.scrollToBottom();
      }
    } else if (existingRealtimeTranscript) {
      existingRealtimeTranscript.remove();
    }

    // Handle pending user transcription (final transcription)
    const existingUserStreaming = document.getElementById(
      'pending-transcription'
    );
    if (pendingTranscription) {
      // Remove real-time transcript if it exists
      if (existingRealtimeTranscript) {
        existingRealtimeTranscript.remove();
      }
      if (!existingUserStreaming) {
        const userMessage = this.createMessageElement({
          role: 'learner',
          content: '',
        });
        userMessage.classList.add('streaming');
        userMessage.id = 'pending-transcription';
        this.messagesContainer.appendChild(userMessage);
        // Only start typewriter for new transcriptions
        this.startTypewriter(
          'pending-transcription',
          pendingTranscription,
          this.typewriterSpeed * 0.8
        );
      }
      // Don't restart typewriter if element already exists
    } else if (existingUserStreaming) {
      existingUserStreaming.remove();
      this.clearTypewriter('pending-transcription');
    }

    // Handle streaming LLM response
    const existingLLMStreaming = document.getElementById(
      'streaming-llm-response'
    );
    if (streamingLLMResponse) {
      console.log(
        '[ChatUI] Handling streaming LLM response:',
        streamingLLMResponse
      );
      if (!existingLLMStreaming) {
        console.log(
          '[ChatUI] Creating new streaming LLM element and starting typewriter'
        );
        const assistantMessage = this.createStreamingMessageElement('');
        assistantMessage.id = 'streaming-llm-response';
        this.messagesContainer.appendChild(assistantMessage);
        // Only start typewriter for new LLM responses
        this.startTypewriter(
          'streaming-llm-response',
          streamingLLMResponse,
          this.typewriterSpeed,
          this.llmTypewriterCallback
        );
      }
      // Don't restart typewriter if element already exists
    } else if (existingLLMStreaming) {
      console.log('[ChatUI] Removing existing LLM streaming element');
      // Clear typewriter first (this will call the completion callback)
      this.clearTypewriter('streaming-llm-response');
      // Then remove the element
      existingLLMStreaming.remove();
    }

    this.scrollToBottom();
  }

  createMessageElement(message) {
    const div = document.createElement('div');
    div.className = `message ${message.role}`;
    div.textContent = message.content;
    
    // Add translation hover for teacher (LLM) messages
    if (message.role === 'teacher') {
      this._setupTranslationHover(div);
    }
    
    return div;
  }

  createStreamingMessageElement(content) {
    const div = document.createElement('div');
    div.className = 'message teacher streaming';

    // Create text node for content
    const textNode = document.createTextNode(content);
    div.appendChild(textNode);

    // Add typing indicator
    const cursor = document.createElement('span');
    cursor.className = 'streaming-cursor';
    cursor.textContent = '▊';
    div.appendChild(cursor);

    // Add translation hover for streaming teacher messages too
    this._setupTranslationHover(div);

    return div;
  }

  createRealtimeTranscriptElement() {
    const div = document.createElement('div');
    div.className = 'message learner streaming realtime';

    // Create container for text
    const textNode = document.createElement('span');
    textNode.className = 'transcript-text';
    div.appendChild(textNode);

    // Add 3-dot loading animation
    const loadingDots = document.createElement('span');
    loadingDots.className = 'loading-dots';
    loadingDots.innerHTML = '<span></span><span></span><span></span>';
    div.appendChild(loadingDots);

    return div;
  }

  renderCurrentTranscript(transcript) {
    if (transcript) {
      this.transcriptContainer.textContent = transcript;
    } else {
      this.transcriptContainer.textContent = '';
    }
  }

  startTypewriter(elementId, fullText, speed, onComplete) {
    const element = document.getElementById(elementId);
    if (!element) {
      // Element doesn't exist, call completion callback immediately if provided
      if (onComplete) {
        console.log(
          `[Typewriter] Element ${elementId} not found, calling completion callback immediately`
        );
        onComplete();
      }
      return;
    }

    // Clear any existing timer for this element
    if (this.typewriterTimers.has(elementId)) {
      const existingTimer = this.typewriterTimers.get(elementId);
      clearInterval(existingTimer.timer || existingTimer);
      this.typewriterTimers.delete(elementId);

      // If there was a previous timer with a callback, call it now since we're replacing it
      if (existingTimer.onComplete) {
        existingTimer.onComplete();
      }
    }

    // Get the text content node (accounting for streaming cursor)
    const textContent = element.querySelector('.streaming-cursor')
      ? element.childNodes[0]
      : element;

    // Start fresh - clear the content and start typing from beginning
    textContent.textContent = '';
    let currentIndex = 0;

    console.log(`[Typewriter] Starting ${elementId}, target: "${fullText}"`);

    const timer = setInterval(() => {
      // Check if element still exists
      const currentElement = document.getElementById(elementId);
      if (!currentElement) {
        console.log(
          `[Typewriter] Element ${elementId} removed, completing immediately`
        );
        clearInterval(timer);
        this.typewriterTimers.delete(elementId);
        if (onComplete) {
          onComplete();
        }
        return;
      }

      if (currentIndex < fullText.length) {
        const newText = fullText.substring(0, currentIndex + 1);
        textContent.textContent = newText;
        currentIndex++;
        this.scrollToBottom();
      } else {
        console.log(`[Typewriter] Complete: ${elementId}`);
        clearInterval(timer);
        this.typewriterTimers.delete(elementId);

        // Call completion callback if provided
        if (onComplete) {
          onComplete();
        }
      }
    }, speed);

    this.typewriterTimers.set(elementId, { timer, fullText, onComplete });
  }

  clearTypewriter(elementId) {
    if (this.typewriterTimers.has(elementId)) {
      const timerData = this.typewriterTimers.get(elementId);
      clearInterval(timerData.timer || timerData);

      // If there's a completion callback, call it before clearing
      // This ensures the text gets finalized even if typewriter is interrupted
      if (timerData.onComplete) {
        console.log(
          `[Typewriter] Clearing ${elementId}, calling completion callback`
        );
        timerData.onComplete();
      }

      this.typewriterTimers.delete(elementId);
    }
  }

  clearAllTypewriters() {
    this.typewriterTimers.forEach((timerData, elementId) => {
      clearInterval(timerData.timer || timerData);
    });
    this.typewriterTimers.clear();
  }

  setLLMTypewriterCallback(callback) {
    this.llmTypewriterCallback = callback;
  }

  scrollToBottom() {
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }
}
