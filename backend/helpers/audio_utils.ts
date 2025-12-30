/**
 * Audio utility functions for format conversion
 */

import * as fs from 'fs';
import * as path from 'path';

// Audio debug logging
const DEBUG_AUDIO = process.env.DEBUG_AUDIO === 'true';
const AUDIO_DEBUG_DIR = path.join(process.cwd(), 'audio-debug');

// Ensure debug directory exists
if (DEBUG_AUDIO && !fs.existsSync(AUDIO_DEBUG_DIR)) {
  fs.mkdirSync(AUDIO_DEBUG_DIR, { recursive: true });
  console.log(`[AudioDebug] Created debug directory: ${AUDIO_DEBUG_DIR}`);
}

// Audio buffer for accumulating chunks per session
const audioBuffers: Map<string, Float32Array[]> = new Map();

/**
 * Add audio chunk to debug buffer
 */
export function debugAddAudioChunk(sessionId: string, float32Data: Float32Array): void {
  if (!DEBUG_AUDIO) return;

  if (!audioBuffers.has(sessionId)) {
    audioBuffers.set(sessionId, []);
    console.log(`[AudioDebug] Started collecting audio for session ${sessionId}`);
  }

  audioBuffers.get(sessionId)!.push(new Float32Array(float32Data));
}

/**
 * Save accumulated audio to WAV file
 */
export function debugSaveAudio(sessionId: string, sampleRate: number = 16000): string | null {
  if (!DEBUG_AUDIO) return null;

  const chunks = audioBuffers.get(sessionId);
  if (!chunks || chunks.length === 0) {
    console.log(`[AudioDebug] No audio to save for session ${sessionId}`);
    return null;
  }

  // Combine all chunks
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  // Convert to WAV
  const wavBuffer = float32ToWav(combined, sampleRate);

  // Save to file
  const filename = `audio_${sessionId}_${Date.now()}.wav`;
  const filepath = path.join(AUDIO_DEBUG_DIR, filename);
  fs.writeFileSync(filepath, wavBuffer);

  console.log(`[AudioDebug] Saved ${combined.length} samples (${(combined.length / sampleRate).toFixed(2)}s) to ${filepath}`);

  // Clear buffer
  audioBuffers.delete(sessionId);

  return filepath;
}

/**
 * Log audio stats for debugging
 * Note: Uses loop instead of spread operator to avoid stack overflow on large arrays
 */
export function debugLogAudioStats(sessionId: string, float32Data: Float32Array): void {
  if (!DEBUG_AUDIO) return;

  // Calculate stats using loops to avoid blocking with large arrays
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let nonZero = 0;
  for (let i = 0; i < float32Data.length; i++) {
    const v = float32Data[i];
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    if (Math.abs(v) > 0.001) nonZero++;
  }
  const avg = sum / float32Data.length;

  console.log(`[AudioDebug] Session ${sessionId.slice(-8)}: samples=${float32Data.length}, min=${min.toFixed(4)}, max=${max.toFixed(4)}, avg=${avg.toFixed(4)}, nonZero=${nonZero}/${float32Data.length}`);
}

/**
 * Convert Float32 audio to WAV buffer
 */
function float32ToWav(samples: Float32Array, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const buffer = Buffer.alloc(totalSize);
  let offset = 0;

  // RIFF header
  buffer.write('RIFF', offset); offset += 4;
  buffer.writeUInt32LE(totalSize - 8, offset); offset += 4;
  buffer.write('WAVE', offset); offset += 4;

  // fmt chunk
  buffer.write('fmt ', offset); offset += 4;
  buffer.writeUInt32LE(16, offset); offset += 4; // chunk size
  buffer.writeUInt16LE(1, offset); offset += 2; // PCM format
  buffer.writeUInt16LE(numChannels, offset); offset += 2;
  buffer.writeUInt32LE(sampleRate, offset); offset += 4;
  buffer.writeUInt32LE(byteRate, offset); offset += 4;
  buffer.writeUInt16LE(blockAlign, offset); offset += 2;
  buffer.writeUInt16LE(bitsPerSample, offset); offset += 2;

  // data chunk
  buffer.write('data', offset); offset += 4;
  buffer.writeUInt32LE(dataSize, offset); offset += 4;

  // Write samples as 16-bit PCM
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const val = s < 0 ? s * 0x8000 : s * 0x7FFF;
    buffer.writeInt16LE(Math.round(val), offset);
    offset += 2;
  }

  return buffer;
}

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
