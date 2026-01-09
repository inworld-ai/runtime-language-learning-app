import type { IOSAudioHandler } from '../types';

type EventCallback = () => void;

export class AudioPlayer {
  private audioContext: AudioContext | null = null;
  private audioQueue: AudioBuffer[] = [];
  private isPlaying = false;
  private isStartingPlayback = false;
  private currentSource: AudioBufferSourceNode | null = null;
  private listeners = new Map<string, EventCallback[]>();
  private streamTimeout: ReturnType<typeof setTimeout> | null = null;
  private isIOS: boolean;
  private iosHandler: IOSAudioHandler | null;

  constructor() {
    this.isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    this.iosHandler = window.iosAudioHandler || null;

    if (this.isIOS && this.iosHandler) {
      console.log('[AudioPlayer] Using iOS audio workarounds for playback');
    }
  }

  on(event: string, callback: EventCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  private emit(event: string): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach((callback) => callback());
    }
  }

  async initialize(): Promise<void> {
    try {
      this.audioContext = new (
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext
      )();

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

  async addAudioStream(
    base64Audio: string,
    sampleRate: number = 16000,
    isLastChunk: boolean = false,
    audioFormat: 'int16' | 'float32' = 'int16'
  ): Promise<void> {
    if (!base64Audio || base64Audio.length === 0) {
      console.warn('Empty audio data received');
      return;
    }

    if (this.streamTimeout) {
      clearTimeout(this.streamTimeout);
    }

    this.streamTimeout = setTimeout(() => {
      this.endStreaming();
    }, 1000);

    // Use iOS handler if available
    if (this.isIOS && this.iosHandler) {
      try {
        await this.iosHandler.playAudioChunk?.(base64Audio, isLastChunk);
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
      // Decode base64 to binary
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);

      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Create audio buffer
      const audioBuffer = await this.createAudioBuffer(
        bytes.buffer,
        sampleRate,
        audioFormat
      );

      this.audioQueue.push(audioBuffer);

      // Start playback immediately if not already playing
      if (!this.isPlaying && !this.isStartingPlayback) {
        this.isStartingPlayback = true;
        requestAnimationFrame(() => {
          this.isStartingPlayback = false;
          this.playNextBuffer();
        });
      }
    } catch (error) {
      console.error('Error processing audio stream:', error);
    }
  }

  private async createAudioBuffer(
    arrayBuffer: ArrayBuffer,
    sampleRate: number,
    audioFormat: 'int16' | 'float32' = 'int16'
  ): Promise<AudioBuffer> {
    if (!this.audioContext) {
      throw new Error('Audio context not initialized');
    }

    let numSamples: number;

    console.log(
      `[AudioPlayer] createAudioBuffer: format=${audioFormat}, byteLength=${arrayBuffer.byteLength}, sampleRate=${sampleRate}`
    );

    if (audioFormat === 'float32') {
      const float32Array = new Float32Array(arrayBuffer);
      numSamples = float32Array.length;
      console.log(
        `[AudioPlayer] Float32 samples: ${numSamples}, first 3 values: [${Array.from(
          float32Array.slice(0, 3)
        )
          .map((v) => v.toFixed(4))
          .join(', ')}]`
      );

      const audioBuffer = this.audioContext.createBuffer(
        1,
        numSamples,
        sampleRate
      );
      const channelData = audioBuffer.getChannelData(0);

      for (let i = 0; i < numSamples; i++) {
        channelData[i] = float32Array[i];
      }

      return audioBuffer;
    } else {
      // Int16 PCM format
      const int16Array = new Int16Array(arrayBuffer);
      numSamples = int16Array.length;
      console.log(`[AudioPlayer] Int16 samples: ${numSamples}`);

      const audioBuffer = this.audioContext.createBuffer(
        1,
        numSamples,
        sampleRate
      );
      const channelData = audioBuffer.getChannelData(0);

      for (let i = 0; i < numSamples; i++) {
        channelData[i] = int16Array[i] / 32768.0;
      }

      return audioBuffer;
    }
  }

  private playNextBuffer(): void {
    if (this.isPlaying && this.currentSource) {
      return;
    }

    if (this.audioQueue.length === 0) {
      this.isPlaying = false;
      this.emit('playback_finished');
      return;
    }

    if (!this.audioContext) return;

    const audioBuffer = this.audioQueue.shift()!;
    this.isPlaying = true;

    this.currentSource = this.audioContext.createBufferSource();
    this.currentSource.buffer = audioBuffer;

    this.currentSource.connect(this.audioContext.destination);

    this.currentSource.onended = () => {
      this.currentSource = null;
      this.playNextBuffer();
    };

    try {
      this.currentSource.start(0);
      this.emit('playback_started');
      console.log(`Playing audio buffer: ${audioBuffer.duration.toFixed(2)}s`);
    } catch (error) {
      console.error('Error starting audio playback:', error);
      this.currentSource = null;
      this.isPlaying = false;
      this.playNextBuffer();
    }
  }

  stop(): void {
    // Use iOS handler if available
    if (this.isIOS && this.iosHandler) {
      this.iosHandler.stopAudioPlayback?.();
      this.isPlaying = false;
      this.isStartingPlayback = false;
      this.emit('playback_stopped');
      return;
    }

    // Standard implementation
    if (this.currentSource) {
      try {
        this.currentSource.stop();
        this.currentSource.disconnect();
        this.currentSource = null;
      } catch (error) {
        console.warn('Error stopping audio source:', error);
      }
    }

    this.audioQueue = [];
    this.isPlaying = false;
    this.isStartingPlayback = false;
    this.emit('playback_stopped');
  }

  destroy(): void {
    this.stop();

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.listeners.clear();
  }

  private endStreaming(): void {
    console.log('[AudioPlayer] Stream ended, finalizing audio playback');

    if (this.streamTimeout) {
      clearTimeout(this.streamTimeout);
      this.streamTimeout = null;
    }

    if (this.isIOS && this.iosHandler) {
      this.iosHandler.playAudioChunk?.('', true);
    }
  }

  markStreamComplete(): void {
    console.log('[AudioPlayer] Stream marked as complete by backend');
    this.endStreaming();
  }

  getQueueLength(): number {
    return this.audioQueue.length;
  }

  isPlaybackActive(): boolean {
    return this.isPlaying;
  }
}
