/**
 * AudioWorklet processor for capturing and resampling microphone audio
 * Buffers to 100ms chunks (1600 samples at 16kHz) to meet AssemblyAI requirements
 * Outputs Float32 audio (backend handles conversion to PCM16)
 */
class AudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.sourceSampleRate = options.processorOptions.sourceSampleRate;
    this.targetSampleRate = 16000;
    this.resampleRatio = this.sourceSampleRate / this.targetSampleRate;

    // Input buffer for resampling
    this.inputBuffer = null;

    // Output buffer to collect 100ms of resampled audio (1600 samples at 16kHz)
    // AssemblyAI requires chunks between 50-1000ms
    this.outputBuffer = [];
    this.outputBufferSize = 1600; // 100ms at 16kHz
  }

  process(inputs) {
    const inputChannel = inputs[0][0];
    if (!inputChannel) return true;

    // Accumulate input samples
    const currentLength = this.inputBuffer ? this.inputBuffer.length : 0;
    const newBuffer = new Float32Array(currentLength + inputChannel.length);
    if (this.inputBuffer) {
      newBuffer.set(this.inputBuffer, 0);
    }
    newBuffer.set(inputChannel, currentLength);
    this.inputBuffer = newBuffer;

    // Resample to 16kHz
    const numOutputSamples = Math.floor(
      this.inputBuffer.length / this.resampleRatio
    );
    if (numOutputSamples === 0) return true;

    const resampledData = new Float32Array(numOutputSamples);
    for (let i = 0; i < numOutputSamples; i++) {
      const correspondingInputIndex = i * this.resampleRatio;
      const lowerIndex = Math.floor(correspondingInputIndex);
      const upperIndex = Math.ceil(correspondingInputIndex);
      const interpolationFactor = correspondingInputIndex - lowerIndex;

      const lowerValue = this.inputBuffer[lowerIndex] || 0;
      const upperValue = this.inputBuffer[upperIndex] || 0;

      resampledData[i] =
        lowerValue + (upperValue - lowerValue) * interpolationFactor;
    }

    // Keep unconsumed input samples
    const consumedInputSamples = numOutputSamples * this.resampleRatio;
    this.inputBuffer = this.inputBuffer.slice(Math.round(consumedInputSamples));

    // Add Float32 samples to output buffer
    for (let i = 0; i < resampledData.length; i++) {
      this.outputBuffer.push(resampledData[i]);

      // When we have 100ms of audio (1600 samples), send it as Float32
      if (this.outputBuffer.length >= this.outputBufferSize) {
        const float32Array = new Float32Array(this.outputBuffer);
        this.port.postMessage(float32Array.buffer, [float32Array.buffer]);
        this.outputBuffer = [];
      }
    }

    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
