class AudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.sourceSampleRate = options.processorOptions.sourceSampleRate;
    this.targetSampleRate = 16000;
    this.resampleRatio = this.sourceSampleRate / this.targetSampleRate;
    this.buffer = null;
  }

  process(inputs) {
    const inputChannel = inputs[0][0];
    if (!inputChannel) return true;

    const currentLength = this.buffer ? this.buffer.length : 0;
    const newBuffer = new Float32Array(currentLength + inputChannel.length);
    if (this.buffer) {
      newBuffer.set(this.buffer, 0);
    }
    newBuffer.set(inputChannel, currentLength);
    this.buffer = newBuffer;

    // Put stuff back into 16k
    const numOutputSamples = Math.floor(
      this.buffer.length / this.resampleRatio
    );
    if (numOutputSamples === 0) return true;

    const resampledData = new Float32Array(numOutputSamples);
    for (let i = 0; i < numOutputSamples; i++) {
      const correspondingInputIndex = i * this.resampleRatio;
      const lowerIndex = Math.floor(correspondingInputIndex);
      const upperIndex = Math.ceil(correspondingInputIndex);
      const interpolationFactor = correspondingInputIndex - lowerIndex;

      const lowerValue = this.buffer[lowerIndex] || 0;
      const upperValue = this.buffer[upperIndex] || 0;

      resampledData[i] =
        lowerValue + (upperValue - lowerValue) * interpolationFactor;
    }

    const consumedInputSamples = numOutputSamples * this.resampleRatio;
    this.buffer = this.buffer.slice(Math.round(consumedInputSamples));

    // Convert Float32Array to Int16Array
    const int16Array = new Int16Array(resampledData.length);
    for (let i = 0; i < resampledData.length; i++) {
      int16Array[i] = Math.max(
        -32768,
        Math.min(32767, resampledData[i] * 32768)
      );
    }

    this.port.postMessage(int16Array.buffer, [int16Array.buffer]);
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
