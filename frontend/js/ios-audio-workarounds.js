/**
 * iOS Audio Workarounds for WebSocket Audio Streaming
 * Handles iOS-specific audio limitations and provides fallback solutions
 */

class IOSAudioHandler {
  constructor() {
    this.isIOS = this.detectIOS();
    this.audioContext = null;
    this.audioUnlocked = false;
    this.microphoneStream = null;
    this.audioProcessor = null;
    this.audioChunks = [];
    this.currentAudioUrl = null;
    this.audioQueue = [];
    this.isPlaying = false;
    
    // iOS-specific audio constraints
    this.audioConstraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 16000,
        channelCount: 1,
        // iOS-specific constraints
        latency: 0.02,
        sampleSize: 16,
        volume: 1.0
      }
    };
    
    if (this.isIOS) {
      console.log('[iOS Audio] iOS device detected, initializing workarounds');
      this.initializeIOSWorkarounds();
    }
  }
  
  detectIOS() {
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;
    
    // Check for iOS devices
    if (/iPad|iPhone|iPod/.test(userAgent) && !window.MSStream) {
      return true;
    }
    
    // Check for iPad on iOS 13+ (reports as Mac)
    if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) {
      return true;
    }
    
    // Additional check for iOS Safari
    const isIOSSafari = !!navigator.userAgent.match(/Version\/[\d\.]+.*Safari/) &&
                       /iPad|iPhone|iPod/.test(navigator.userAgent);
    
    return isIOSSafari;
  }
  
  initializeIOSWorkarounds() {
    // Add touch event listeners for audio unlock
    this.setupTouchHandlers();
    
    // Setup visibility change handler to resume audio
    this.setupVisibilityHandler();
    
    // Add iOS-specific meta tags if not present
    this.addIOSMetaTags();
    
    // Prevent iOS zoom on double-tap
    this.preventDoubleTapZoom();
  }
  
  setupTouchHandlers() {
    // Unlock audio on first user interaction
    const unlockAudio = async () => {
      if (!this.audioUnlocked) {
        await this.unlockAudioContext();
        this.audioUnlocked = true;
        console.log('[iOS Audio] Audio unlocked via user interaction');
      }
    };
    
    // Add multiple event types to catch user interaction
    ['touchstart', 'touchend', 'click'].forEach(eventType => {
      document.addEventListener(eventType, unlockAudio, { once: true, passive: true });
    });
  }
  
  setupVisibilityHandler() {
    // Resume audio context when app becomes visible
    document.addEventListener('visibilitychange', async () => {
      if (!document.hidden && this.audioContext) {
        if (this.audioContext.state === 'suspended') {
          await this.audioContext.resume();
          console.log('[iOS Audio] Resumed audio context after visibility change');
        }
      }
    });
  }
  
  addIOSMetaTags() {
    // Ensure proper viewport settings for iOS
    let viewport = document.querySelector('meta[name="viewport"]');
    if (!viewport) {
      viewport = document.createElement('meta');
      viewport.name = 'viewport';
      document.head.appendChild(viewport);
    }
    viewport.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
    
    // Add iOS web app capable meta tag
    if (!document.querySelector('meta[name="apple-mobile-web-app-capable"]')) {
      const webAppMeta = document.createElement('meta');
      webAppMeta.name = 'apple-mobile-web-app-capable';
      webAppMeta.content = 'yes';
      document.head.appendChild(webAppMeta);
    }
  }
  
  preventDoubleTapZoom() {
    let lastTouchEnd = 0;
    document.addEventListener('touchend', (event) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) {
        event.preventDefault();
      }
      lastTouchEnd = now;
    }, false);
  }
  
  async unlockAudioContext() {
    try {
      // Create or resume audio context
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
          sampleRate: 16000,
          latencyHint: 'interactive'
        });
      }
      
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      // Play a silent buffer to unlock audio
      const buffer = this.audioContext.createBuffer(1, 1, 22050);
      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioContext.destination);
      source.start(0);
      
      console.log('[iOS Audio] AudioContext unlocked, state:', this.audioContext.state);
      
      // Dispatch custom event to notify app
      window.dispatchEvent(new CustomEvent('ios-audio-unlocked', {
        detail: { audioContext: this.audioContext }
      }));
      
      return this.audioContext;
    } catch (error) {
      console.error('[iOS Audio] Failed to unlock audio context:', error);
      throw error;
    }
  }
  
  async startMicrophone(onAudioData) {
    try {
      console.log('[iOS Audio] Starting microphone...');
      
      // Ensure audio context is ready
      if (!this.audioContext || this.audioContext.state === 'suspended') {
        await this.unlockAudioContext();
      }
      
      // Request microphone permission with iOS-optimized constraints
      this.microphoneStream = await navigator.mediaDevices.getUserMedia(this.audioConstraints);
      console.log('[iOS Audio] Microphone access granted');
      
      // Create audio processing pipeline
      const source = this.audioContext.createMediaStreamSource(this.microphoneStream);
      
      // Use ScriptProcessorNode for iOS compatibility (AudioWorklet may not work)
      const bufferSize = 4096;
      this.audioProcessor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
      
      this.audioProcessor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0);
        
        // Convert Float32Array to Int16Array
        const int16Array = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        
        // Convert to base64
        const base64Audio = this.arrayBufferToBase64(int16Array.buffer);
        
        // Call the callback with audio data
        if (onAudioData) {
          onAudioData(base64Audio);
        }
      };
      
      // Connect the pipeline
      source.connect(this.audioProcessor);
      this.audioProcessor.connect(this.audioContext.destination);
      
      console.log('[iOS Audio] Microphone pipeline connected');
      return true;
    } catch (error) {
      console.error('[iOS Audio] Failed to start microphone:', error);
      
      // Provide user-friendly error message
      if (error.name === 'NotAllowedError') {
        alert('Microphone access denied. Please enable microphone permissions in Settings > Safari > Microphone.');
      } else if (error.name === 'NotFoundError') {
        alert('No microphone found. Please ensure your device has a working microphone.');
      } else {
        alert(`Microphone error: ${error.message}`);
      }
      
      throw error;
    }
  }
  
  stopMicrophone() {
    console.log('[iOS Audio] Stopping microphone...');
    
    if (this.audioProcessor) {
      this.audioProcessor.disconnect();
      this.audioProcessor = null;
    }
    
    if (this.microphoneStream) {
      this.microphoneStream.getTracks().forEach(track => track.stop());
      this.microphoneStream = null;
    }
    
    console.log('[iOS Audio] Microphone stopped');
  }
  
  // Audio playback methods for iOS
  async playAudioChunk(base64Audio, isLastChunk = false) {
    try {
      // Add chunk to queue
      this.audioChunks.push(base64Audio);
      
      // If this is the last chunk or we have enough chunks, create and play audio
      if (isLastChunk || this.audioChunks.length > 5) {
        await this.playAccumulatedAudio();
      }
    } catch (error) {
      console.error('[iOS Audio] Failed to play audio chunk:', error);
    }
  }
  
  async playAccumulatedAudio() {
    if (this.audioChunks.length === 0) return;
    
    try {
      // Combine all chunks
      const combinedBase64 = this.audioChunks.join('');
      this.audioChunks = []; // Clear chunks
      
      // Convert base64 to blob
      const audioData = atob(combinedBase64);
      const arrayBuffer = new ArrayBuffer(audioData.length);
      const uint8Array = new Uint8Array(arrayBuffer);
      
      for (let i = 0; i < audioData.length; i++) {
        uint8Array[i] = audioData.charCodeAt(i);
      }
      
      // Create blob with appropriate MIME type
      const audioBlob = new Blob([uint8Array], { type: 'audio/mpeg' });
      const audioUrl = URL.createObjectURL(audioBlob);
      
      // Clean up previous audio URL
      if (this.currentAudioUrl) {
        URL.revokeObjectURL(this.currentAudioUrl);
      }
      this.currentAudioUrl = audioUrl;
      
      // Get or create audio element
      const audioElement = document.querySelector('audio') || document.createElement('audio');
      
      // iOS-specific audio element setup
      audioElement.setAttribute('playsinline', '');
      audioElement.setAttribute('webkit-playsinline', '');
      audioElement.preload = 'auto';
      
      // Add to queue for sequential playback
      this.audioQueue.push(audioUrl);
      
      // Start playback if not already playing
      if (!this.isPlaying) {
        await this.playNextInQueue(audioElement);
      }
      
    } catch (error) {
      console.error('[iOS Audio] Failed to play accumulated audio:', error);
    }
  }
  
  async playNextInQueue(audioElement) {
    if (this.audioQueue.length === 0) {
      this.isPlaying = false;
      window.dispatchEvent(new CustomEvent('ios-audio-ended'));
      return;
    }
    
    this.isPlaying = true;
    const audioUrl = this.audioQueue.shift();
    
    return new Promise((resolve) => {
      audioElement.src = audioUrl;
      
      audioElement.onended = async () => {
        URL.revokeObjectURL(audioUrl);
        await this.playNextInQueue(audioElement);
        resolve();
      };
      
      audioElement.onerror = (error) => {
        console.error('[iOS Audio] Playback error:', error);
        URL.revokeObjectURL(audioUrl);
        this.playNextInQueue(audioElement);
        resolve();
      };
      
      // Attempt to play with user gesture handling
      const playPromise = audioElement.play();
      
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            console.log('[iOS Audio] Playback started successfully');
          })
          .catch(async (error) => {
            console.error('[iOS Audio] Playback failed:', error);
            
            // If playback fails due to user interaction requirement
            if (error.name === 'NotAllowedError') {
              // Wait for user interaction
              console.log('[iOS Audio] Waiting for user interaction to play audio...');
              
              const playOnInteraction = async () => {
                try {
                  await audioElement.play();
                  console.log('[iOS Audio] Playback started after user interaction');
                  document.removeEventListener('touchstart', playOnInteraction);
                  document.removeEventListener('click', playOnInteraction);
                } catch (e) {
                  console.error('[iOS Audio] Still cannot play:', e);
                }
              };
              
              document.addEventListener('touchstart', playOnInteraction, { once: true });
              document.addEventListener('click', playOnInteraction, { once: true });
            }
          });
      }
    });
  }
  
  stopAudioPlayback() {
    console.log('[iOS Audio] Stopping audio playback...');
    
    // Clear audio queue
    this.audioQueue = [];
    this.audioChunks = [];
    this.isPlaying = false;
    
    // Stop current audio
    const audioElement = document.querySelector('audio');
    if (audioElement) {
      audioElement.pause();
      audioElement.src = '';
    }
    
    // Clean up audio URLs
    if (this.currentAudioUrl) {
      URL.revokeObjectURL(this.currentAudioUrl);
      this.currentAudioUrl = null;
    }
  }
  
  // Utility methods
  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  
  base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
  
  // WebSocket connection helper for iOS
  getOptimizedWebSocketURL() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const hostname = location.hostname;
    const port = location.port || (protocol === 'wss:' ? '443' : '80');
    
    // For production
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      return `${protocol}//${hostname}:${port}`;
    }
    
    // For local development with iOS device
    // Try to use the computer's local IP address
    if (this.isIOS && hostname === 'localhost') {
      // You'll need to replace this with your computer's local IP
      // Or implement auto-discovery
      console.warn('[iOS Audio] Using localhost, consider using computer IP address for iOS testing');
    }
    
    return `${protocol}//${hostname}:8765`;
  }
  
  // Enhanced error handling for iOS
  handleIOSError(error, context) {
    console.error(`[iOS Audio] Error in ${context}:`, error);
    
    const errorMessages = {
      'NotAllowedError': 'Permission denied. Please allow microphone/audio access.',
      'NotFoundError': 'Required audio hardware not found.',
      'NotReadableError': 'Audio hardware is in use by another application.',
      'OverconstrainedError': 'Audio constraints cannot be satisfied.',
      'SecurityError': 'Audio access blocked due to security settings.',
      'TypeError': 'Invalid audio configuration.'
    };
    
    const message = errorMessages[error.name] || `Audio error: ${error.message}`;
    
    // Dispatch error event for app to handle
    window.dispatchEvent(new CustomEvent('ios-audio-error', {
      detail: { error, context, message }
    }));
    
    return message;
  }
}

// Export for use in main application
window.IOSAudioHandler = IOSAudioHandler;

// Auto-initialize if on iOS
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.iosAudioHandler = new IOSAudioHandler();
  });
} else {
  window.iosAudioHandler = new IOSAudioHandler();
}