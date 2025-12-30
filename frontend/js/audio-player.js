export class AudioPlayer {
  constructor() {
    this.audioContext = null;
    this.audioQueue = [];
    this.isPlaying = false;
    this.isStartingPlayback = false;
    this.currentSource = null;
    this.sampleRate = 16000; // Default sample rate to match backend
    this.listeners = new Map();
    this.isStreamingActive = false;
    this.streamTimeout = null;

    // Check for iOS and use iOS handler if available
    this.isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    this.iosHandler = window.iosAudioHandler || null;

    if (this.isIOS && this.iosHandler) {
      console.log('[AudioPlayer] Using iOS audio workarounds for playback');
    }
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  emit(event, data) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach((callback) => callback(data));
    }
  }

  async initialize() {
    try {
      this.audioContext = new (window.AudioContext ||
        window.webkitAudioContext)();

      // Resume AudioContext if suspended
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      console.log(
        'Audio player initialized with sample rate:',
        this.audioContext.sampleRate
      );
    } catch (error) {
      console.error('Failed to initialize audio player:', error);
      throw error;
    }
  }

  async addAudioStream(base64Audio, sampleRate = 16000, isLastChunk = false, audioFormat = 'int16') {
    if (!base64Audio || base64Audio.length === 0) {
      console.warn('Empty audio data received');
      return;
    }

    // Mark streaming as active
    this.isStreamingActive = true;

    // Clear any existing timeout
    if (this.streamTimeout) {
      clearTimeout(this.streamTimeout);
    }

    // Set a timeout to detect end of streaming (if no new chunks for 1 second)
    this.streamTimeout = setTimeout(() => {
      this.endStreaming();
    }, 1000);

    // Use iOS handler for audio playback if available
    if (this.isIOS && this.iosHandler) {
      try {
        await this.iosHandler.playAudioChunk(base64Audio, isLastChunk);
        if (!this.isPlaying) {
          this.isPlaying = true;
          this.emit('playback_started');
        }
        return;
      } catch (error) {
        console.error(
          '[AudioPlayer] iOS playback failed, falling back to standard:',
          error
        );
      }
    }

    // Standard implementation
    if (!this.audioContext) {
      await this.initialize();
    }

    try {
      this.sampleRate = sampleRate;

      // Decode base64 to binary
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);

      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Create audio buffer from the decoded data
      const audioBuffer = await this.createAudioBuffer(
        bytes.buffer,
        sampleRate,
        audioFormat
      );

      // Queue the audio buffer for playback
      this.audioQueue.push(audioBuffer);

      // Start playback immediately if not already playing
      // Use a flag to prevent race conditions
      if (!this.isPlaying && !this.isStartingPlayback) {
        this.isStartingPlayback = true;
        // Use requestAnimationFrame for better timing
        requestAnimationFrame(() => {
          this.isStartingPlayback = false;
          this.playNextBuffer();
        });
      }
    } catch (error) {
      console.error('Error processing audio stream:', error);
    }
  }

  async createAudioBuffer(arrayBuffer, sampleRate, audioFormat = 'int16') {
    try {
      let channelData;
      let numSamples;

      console.log(`[AudioPlayer] createAudioBuffer: format=${audioFormat}, byteLength=${arrayBuffer.byteLength}, sampleRate=${sampleRate}`);

      if (audioFormat === 'float32') {
        // Float32 PCM - bytes are IEEE 754 Float32 representation
        // 4 bytes per sample, values already in [-1.0, 1.0] range
        const float32Array = new Float32Array(arrayBuffer);
        numSamples = float32Array.length;
        console.log(`[AudioPlayer] Float32 samples: ${numSamples}, first 3 values: [${Array.from(float32Array.slice(0, 3)).map(v => v.toFixed(4)).join(', ')}]`);

        const audioBuffer = this.audioContext.createBuffer(
          1,
          numSamples,
          sampleRate
        );
        channelData = audioBuffer.getChannelData(0);

        for (let i = 0; i < numSamples; i++) {
          channelData[i] = float32Array[i];
        }

        return audioBuffer;
      } else {
        // Int16 PCM format - convert to Float32
        const int16Array = new Int16Array(arrayBuffer);
        numSamples = int16Array.length;
        console.log(`[AudioPlayer] Int16 samples: ${numSamples}`);

        const audioBuffer = this.audioContext.createBuffer(
          1,
          numSamples,
          sampleRate
        );
        channelData = audioBuffer.getChannelData(0);

        for (let i = 0; i < numSamples; i++) {
          channelData[i] = int16Array[i] / 32768.0;
        }

        return audioBuffer;
      }
    } catch (error) {
      console.error('Error creating audio buffer:', error);
      throw error;
    }
  }

  playNextBuffer() {
    // Prevent multiple simultaneous calls
    if (this.isPlaying && this.currentSource) {
      return;
    }

    if (this.audioQueue.length === 0) {
      this.isPlaying = false;
      this.emit('playback_finished');
      return;
    }

    const audioBuffer = this.audioQueue.shift();
    this.isPlaying = true;

    // Create buffer source
    this.currentSource = this.audioContext.createBufferSource();
    this.currentSource.buffer = audioBuffer;

    // Connect to destination
    this.currentSource.connect(this.audioContext.destination);

    // Set up event handlers
    this.currentSource.onended = () => {
      this.currentSource = null;
      // Play next buffer in queue
      this.playNextBuffer();
    };

    // Start playback
    try {
      this.currentSource.start(0);
      this.emit('playback_started');
      console.log(`Playing audio buffer: ${audioBuffer.duration.toFixed(2)}s`);
    } catch (error) {
      console.error('Error starting audio playback:', error);
      this.currentSource = null;
      this.isPlaying = false;
      // Try next buffer
      this.playNextBuffer();
    }
  }

  stop() {
    // Use iOS handler if available
    if (this.isIOS && this.iosHandler) {
      this.iosHandler.stopAudioPlayback();
      this.isPlaying = false;
      this.isStartingPlayback = false;
      this.emit('playback_stopped');
      return;
    }

    // Standard implementation
    // Stop current source first
    if (this.currentSource) {
      try {
        this.currentSource.stop();
        this.currentSource.disconnect();
        this.currentSource = null;
      } catch (error) {
        // Source might already be stopped, ignore
        console.warn('Error stopping audio source:', error);
      }
    }

    // Clear the queue and reset flags
    this.audioQueue = [];
    this.isPlaying = false;
    this.isStartingPlayback = false;
    this.emit('playback_stopped');
  }

  destroy() {
    this.stop();

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.listeners.clear();
  }

  getQueueLength() {
    return this.audioQueue.length;
  }

  isPlaybackActive() {
    return this.isPlaying;
  }

  endStreaming() {
    console.log('[AudioPlayer] Stream ended, finalizing audio playback');
    this.isStreamingActive = false;

    // Clear timeout
    if (this.streamTimeout) {
      clearTimeout(this.streamTimeout);
      this.streamTimeout = null;
    }

    // For iOS, signal that streaming is complete
    if (this.isIOS && this.iosHandler) {
      this.iosHandler.playAudioChunk('', true); // Send empty chunk with isLastChunk=true
    }
  }

  // Method to be called when backend signals stream complete
  markStreamComplete() {
    console.log('[AudioPlayer] Stream marked as complete by backend');
    this.endStreaming();
  }
}
