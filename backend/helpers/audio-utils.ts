/**
 * Audio utility functions for format conversion
 */

/**
 * Convert Float32Array audio data to Int16Array (PCM16)
 */
export function float32ToPCM16(float32Data: Float32Array): Int16Array {
  const pcm16 = new Int16Array(float32Data.length);
  for (let i = 0; i < float32Data.length; i++) {
    // Clamp to [-1, 1] range and convert to Int16 range [-32768, 32767]
    const s = Math.max(-1, Math.min(1, float32Data[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return pcm16;
}

/**
 * Convert number[] or Float32Array audio data to Int16Array (PCM16)
 * This is an optimized version that handles both types to avoid
 * intermediate allocations in the audio pipeline.
 */
export function audioDataToPCM16(audioData: number[] | Float32Array): Int16Array {
  const pcm16 = new Int16Array(audioData.length);
  for (let i = 0; i < audioData.length; i++) {
    // Clamp to [-1, 1] range and convert to Int16 range [-32768, 32767]
    const s = Math.max(-1, Math.min(1, audioData[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return pcm16;
}

/**
 * Convert Int16Array (PCM16) to Float32Array
 */
export function pcm16ToFloat32(pcm16Data: Int16Array): Float32Array {
  const float32 = new Float32Array(pcm16Data.length);
  for (let i = 0; i < pcm16Data.length; i++) {
    float32[i] = pcm16Data[i] / 32768.0;
  }
  return float32;
}

/**
 * Convert audio data to PCM16 base64 string for WebSocket transmission
 */
export function convertToPCM16Base64(
  audioData: number[] | Float32Array | string | undefined,
  _sampleRate: number | undefined,
  _logPrefix: string = 'Audio'
): string | null {
  if (!audioData) {
    return null;
  }

  let base64Data: string;

  if (typeof audioData === 'string') {
    // Already base64 encoded
    base64Data = audioData;
  } else {
    // Convert Float32 array to PCM16 base64
    const float32Data = Array.isArray(audioData)
      ? new Float32Array(audioData)
      : audioData;
    const pcm16Data = float32ToPCM16(float32Data);
    base64Data = Buffer.from(pcm16Data.buffer).toString('base64');
  }

  return base64Data;
}

/**
 * Decode base64 audio to Float32Array
 * Frontend sends Float32 audio data directly (4 bytes per sample)
 * Note: Node.js Buffer objects share ArrayBuffers with offsets, so we need to copy
 */
export function decodeBase64ToFloat32(base64Audio: string): Float32Array {
  const buffer = Buffer.from(base64Audio, 'base64');
  // Create a clean copy to avoid Node.js Buffer's internal ArrayBuffer sharing
  const cleanArray = new Uint8Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    cleanArray[i] = buffer[i];
  }
  // Interpret bytes directly as Float32 (4 bytes per sample)
  return new Float32Array(cleanArray.buffer);
}

