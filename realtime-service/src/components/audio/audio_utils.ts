/**
 * Audio utility functions for converting between audio formats
 */
import logger from '../../logger';

/**
 * Convert Float32Array (-1.0 to 1.0) to Int16Array PCM16 (-32768 to 32767)
 * @param float32Data - Input audio data as Float32Array
 * @returns Int16Array containing PCM16 audio data
 */
export function float32ToPCM16(float32Data: Float32Array): Int16Array {
  const pcm16 = new Int16Array(float32Data.length);
  for (let i = 0; i < float32Data.length; i++) {
    // Clamp values to [-1, 1] range
    const clamped = Math.max(-1, Math.min(1, float32Data[i]));
    // Convert to 16-bit PCM
    pcm16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return pcm16;
}

/**
 * Convert audio data to PCM16 base64 format for OpenAI Realtime API
 * @param audioData - Audio data in various formats (array, Buffer, Float32Array, base64 string)
 * @param sampleRate - Sample rate of the audio (for logging purposes)
 * @param debugLabel - Label for debug logging
 * @returns Base64 encoded PCM16 audio data, or null if conversion fails
 */
export function convertToPCM16Base64(
  audioData: any,
  sampleRate?: number,
  debugLabel: string = 'Audio',
): string | null {
  if (!audioData) {
    logger.error({ debugLabel }, 'Audio Utils - No audio data provided');
    return null;
  }

  // Convert audio data to Float32Array based on its actual type
  let floatSamples: Float32Array;

  if (Array.isArray(audioData)) {
    // The array contains byte values from a Buffer, not float values
    // Interpret these bytes as Float32 data (4 bytes per float)
    // console.log(`[${debugLabel}] Converting byte array to Float32Array`);
    const byteBuffer = Buffer.from(audioData);
    floatSamples = new Float32Array(
      byteBuffer.buffer,
      byteBuffer.byteOffset,
      byteBuffer.length / 4,
    );
  } else if (Buffer.isBuffer(audioData)) {
    // If it's already a Buffer
    logger.debug({ debugLabel }, 'Audio Utils - Converting Buffer to Float32Array');
    floatSamples = new Float32Array(
      audioData.buffer,
      audioData.byteOffset,
      audioData.length / 4,
    );
  } else if (audioData instanceof Float32Array) {
    // Already Float32Array
    logger.debug({ debugLabel }, 'Audio Utils - Using existing Float32Array');
    floatSamples = audioData;
  } else if (typeof audioData === 'string') {
    // If it's a base64 string (legacy format)
    logger.debug({ debugLabel }, 'Audio Utils - Decoding base64 string to Float32Array');
    const decodedData = Buffer.from(audioData, 'base64');
    floatSamples = new Float32Array(
      decodedData.buffer,
      decodedData.byteOffset,
      decodedData.length / 4,
    );
  } else {
    logger.error({ debugLabel, dataType: typeof audioData }, `Audio Utils - Unsupported audio data type: ${typeof audioData}`);
    return null;
  }

  // Validate Float32Array has data
  if (floatSamples.length === 0) {
    logger.warn({ debugLabel }, 'Audio Utils - Skipping zero-length audio samples');
    return null;
  }

  // Convert Float32 (-1.0 to 1.0) to PCM16 (-32768 to 32767)
  const pcm16 = float32ToPCM16(floatSamples);

  const audioBase64 = Buffer.from(pcm16.buffer).toString('base64');
  logger.debug({ debugLabel, length: audioBase64.length }, 'Audio Utils - Sending base64 audio');

  return audioBase64;
}
