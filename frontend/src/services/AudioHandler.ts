import type { IOSAudioHandler } from '../types';

type EventCallback = (data: string) => void;

export class AudioHandler {
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private stream: MediaStream | null = null;
  private microphone: MediaStreamAudioSourceNode | null = null;
  private isStreaming = false;
  private listeners = new Map<string, EventCallback[]>();
  private isIOS: boolean;
  private iosHandler: IOSAudioHandler | null;

  constructor() {
    this.isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    this.iosHandler = window.iosAudioHandler || null;

    if (this.isIOS && this.iosHandler) {
      console.log('[AudioHandler] Using iOS audio workarounds');
      this.setupIOSEventListeners();
    }
  }

  private setupIOSEventListeners(): void {
    window.addEventListener('ios-audio-unlocked', ((event: CustomEvent) => {
      console.log('[AudioHandler] iOS audio unlocked');
      this.audioContext = event.detail.audioContext;
    }) as EventListener);

    window.addEventListener('ios-audio-error', ((event: CustomEvent) => {
      console.error('[AudioHandler] iOS audio error:', event.detail.message);
      this.emit('error', event.detail);
    }) as EventListener);

    window.addEventListener('ios-audio-ended', () => {
      console.log('[AudioHandler] iOS audio playback ended');
      this.emit('playback_finished', '');
    });
  }

  on(event: string, callback: EventCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  off(event: string, callback: EventCallback): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  clearAllListeners(): void {
    this.listeners.clear();
  }

  private emit(event: string, data: string): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach((callback) => callback(data));
    }
  }

  async startStreaming(): Promise<void> {
    try {
      console.log('Starting continuous audio streaming...');

      // Use iOS handler if available
      if (this.isIOS && this.iosHandler) {
        console.log('[AudioHandler] Using iOS audio handler for microphone');

        await this.iosHandler.unlockAudioContext?.();

        const success = await this.iosHandler.startMicrophone?.((audioData) => {
          if (this.isStreaming) {
            this.emit('audioChunk', audioData);
          }
        });

        if (success) {
          this.isStreaming = true;
          console.log('[AudioHandler] iOS microphone started successfully');
          return;
        }
      }

      // Fallback to standard implementation
      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      };

      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('Microphone access granted for continuous streaming');

      this.audioContext = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext)();

      if (this.audioContext.state === 'suspended') {
        console.log('Audio context suspended, resuming...');
        await this.audioContext.resume();
      }

      this.microphone = this.audioContext.createMediaStreamSource(this.stream);

      // Try AudioWorklet first, fallback to ScriptProcessorNode
      if (this.audioContext.audioWorklet) {
        console.log('Setting up AudioWorklet processor...');
        await this.setupAudioWorklet();
      } else {
        console.log('AudioWorklet not supported, using ScriptProcessorNode...');
        this.setupScriptProcessorNode();
      }

      this.isStreaming = true;
      console.log('Continuous audio streaming started');
    } catch (error) {
      console.error('Error starting continuous audio:', error);
      throw error;
    }
  }

  private async setupAudioWorklet(): Promise<void> {
    if (!this.audioContext || !this.microphone) return;

    try {
      await this.audioContext.audioWorklet.addModule('/audio-processor.js');
      console.log('AudioWorklet processor loaded');

      this.workletNode = new AudioWorkletNode(
        this.audioContext,
        'audio-processor',
        {
          processorOptions: {
            sourceSampleRate: this.audioContext.sampleRate,
          },
        }
      );

      this.workletNode.port.onmessage = (event: MessageEvent) => {
        if (this.isStreaming) {
          const int16Buffer = event.data as ArrayBuffer;
          const base64Audio = btoa(
            String.fromCharCode(...new Uint8Array(int16Buffer))
          );
          this.emit('audioChunk', base64Audio);
        }
      };

      this.microphone.connect(this.workletNode);
      this.workletNode.connect(this.audioContext.destination);
    } catch (error) {
      console.error('Error loading AudioWorklet processor:', error);
      this.setupScriptProcessorNode();
    }
  }

  private setupScriptProcessorNode(): void {
    if (!this.audioContext || !this.microphone) return;

    console.log('Setting up ScriptProcessorNode for compatibility...');

    const bufferSize = 4096;
    this.scriptProcessor = this.audioContext.createScriptProcessor(
      bufferSize,
      1,
      1
    );

    const targetSampleRate = 16000;
    const sourceSampleRate = this.audioContext.sampleRate;
    const resampleRatio = sourceSampleRate / targetSampleRate;
    let buffer: Float32Array | null = null;

    this.scriptProcessor.onaudioprocess = (event: AudioProcessingEvent) => {
      if (this.isStreaming) {
        const inputData = event.inputBuffer.getChannelData(0);

        // Append new data to the buffer
        const currentLength = buffer ? buffer.length : 0;
        const newBuffer = new Float32Array(currentLength + inputData.length);
        if (buffer) {
          newBuffer.set(buffer, 0);
        }
        newBuffer.set(inputData, currentLength);
        buffer = newBuffer;

        // Resample to 16kHz
        const numOutputSamples = Math.floor(buffer.length / resampleRatio);
        if (numOutputSamples === 0) return;

        const resampledData = new Float32Array(numOutputSamples);
        for (let i = 0; i < numOutputSamples; i++) {
          const correspondingInputIndex = i * resampleRatio;
          const lowerIndex = Math.floor(correspondingInputIndex);
          const upperIndex = Math.ceil(correspondingInputIndex);
          const interpolationFactor = correspondingInputIndex - lowerIndex;

          const lowerValue = buffer[lowerIndex] || 0;
          const upperValue = buffer[upperIndex] || 0;

          resampledData[i] =
            lowerValue + (upperValue - lowerValue) * interpolationFactor;
        }

        // Save remainder for next process call
        const consumedInputSamples = numOutputSamples * resampleRatio;
        buffer = buffer.slice(Math.round(consumedInputSamples));

        // Convert Float32Array to Int16Array
        const int16Array = new Int16Array(resampledData.length);
        for (let i = 0; i < resampledData.length; i++) {
          int16Array[i] = Math.max(
            -32768,
            Math.min(32767, resampledData[i] * 32768)
          );
        }

        const base64Audio = btoa(
          String.fromCharCode(...new Uint8Array(int16Array.buffer))
        );
        this.emit('audioChunk', base64Audio);
      }
    };

    this.microphone.connect(this.scriptProcessor);
    this.scriptProcessor.connect(this.audioContext.destination);
  }

  stopStreaming(): void {
    console.log('Stopping continuous audio streaming...');
    this.isStreaming = false;

    // Use iOS handler if available
    if (this.isIOS && this.iosHandler) {
      this.iosHandler.stopMicrophone?.();
      console.log('[AudioHandler] iOS microphone stopped');
      return;
    }

    // Standard cleanup
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    if (this.scriptProcessor) {
      this.scriptProcessor.onaudioprocess = null;
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }

    if (this.microphone) {
      this.microphone.disconnect();
      this.microphone = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    console.log('Continuous audio streaming stopped');
  }

  getIsStreaming(): boolean {
    return this.isStreaming;
  }
}
