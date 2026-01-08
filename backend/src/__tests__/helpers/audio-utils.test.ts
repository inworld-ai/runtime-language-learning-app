import { describe, it, expect } from 'vitest';
import {
  float32ToPCM16,
  pcm16ToFloat32,
  audioDataToPCM16,
  decodeBase64ToFloat32,
  convertToPCM16Base64,
} from '../../helpers/audio-utils.js';

describe('audio-utils', () => {
  describe('float32ToPCM16', () => {
    it('converts silence (0.0) to 0', () => {
      const input = new Float32Array([0.0, 0.0, 0.0]);
      const result = float32ToPCM16(input);
      expect(result).toEqual(new Int16Array([0, 0, 0]));
    });

    it('converts max positive (1.0) to 32767', () => {
      const input = new Float32Array([1.0]);
      const result = float32ToPCM16(input);
      expect(result[0]).toBe(32767);
    });

    it('converts max negative (-1.0) to -32768', () => {
      const input = new Float32Array([-1.0]);
      const result = float32ToPCM16(input);
      expect(result[0]).toBe(-32768);
    });

    it('clamps values outside [-1, 1] range', () => {
      const input = new Float32Array([2.0, -2.0]);
      const result = float32ToPCM16(input);
      expect(result[0]).toBe(32767);
      expect(result[1]).toBe(-32768);
    });

    it('converts mid-range values correctly', () => {
      const input = new Float32Array([0.5, -0.5]);
      const result = float32ToPCM16(input);
      // 0.5 * 32767 = 16383.5, rounded to 16383
      expect(result[0]).toBe(16383);
      // -0.5 * 32768 = -16384
      expect(result[1]).toBe(-16384);
    });
  });

  describe('audioDataToPCM16', () => {
    it('converts number array to PCM16', () => {
      const input = [0.0, 1.0, -1.0];
      const result = audioDataToPCM16(input);
      expect(result[0]).toBe(0);
      expect(result[1]).toBe(32767);
      expect(result[2]).toBe(-32768);
    });

    it('converts Float32Array to PCM16', () => {
      const input = new Float32Array([0.5, -0.5]);
      const result = audioDataToPCM16(input);
      expect(result[0]).toBe(16383);
      expect(result[1]).toBe(-16384);
    });
  });

  describe('pcm16ToFloat32', () => {
    it('converts 0 to 0.0', () => {
      const input = new Int16Array([0]);
      const result = pcm16ToFloat32(input);
      expect(result[0]).toBeCloseTo(0.0);
    });

    it('converts 32767 to approximately 1.0', () => {
      const input = new Int16Array([32767]);
      const result = pcm16ToFloat32(input);
      expect(result[0]).toBeCloseTo(1.0, 2);
    });

    it('converts -32768 to -1.0', () => {
      const input = new Int16Array([-32768]);
      const result = pcm16ToFloat32(input);
      expect(result[0]).toBe(-1.0);
    });

    it('round-trips values correctly', () => {
      const original = new Float32Array([0.0, 0.5, -0.5, 0.75, -0.75]);
      const pcm16 = float32ToPCM16(original);
      const roundTripped = pcm16ToFloat32(pcm16);

      for (let i = 0; i < original.length; i++) {
        // Allow small precision loss due to quantization
        expect(roundTripped[i]).toBeCloseTo(original[i], 2);
      }
    });
  });

  describe('decodeBase64ToFloat32', () => {
    it('decodes base64 audio to Float32Array', () => {
      // Create a known Float32Array, encode to base64, decode back
      const original = new Float32Array([0.5, -0.5, 0.0, 1.0]);
      const buffer = Buffer.from(original.buffer);
      const base64 = buffer.toString('base64');

      const decoded = decodeBase64ToFloat32(base64);

      expect(decoded.length).toBe(4);
      expect(decoded[0]).toBeCloseTo(0.5);
      expect(decoded[1]).toBeCloseTo(-0.5);
      expect(decoded[2]).toBeCloseTo(0.0);
      expect(decoded[3]).toBeCloseTo(1.0);
    });

    it('handles empty base64 string', () => {
      const decoded = decodeBase64ToFloat32('');
      expect(decoded.length).toBe(0);
    });
  });

  describe('convertToPCM16Base64', () => {
    it('returns null for undefined input', () => {
      const result = convertToPCM16Base64(undefined, 16000);
      expect(result).toBeNull();
    });

    it('passes through already base64 encoded strings', () => {
      const base64Input = 'SGVsbG8gV29ybGQ=';
      const result = convertToPCM16Base64(base64Input, 16000);
      expect(result).toBe(base64Input);
    });

    it('converts Float32Array to base64 PCM16', () => {
      const input = new Float32Array([0.0, 1.0, -1.0]);
      const result = convertToPCM16Base64(input, 16000);

      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');

      // Decode and verify the PCM16 values
      const buffer = Buffer.from(result!, 'base64');
      const pcm16 = new Int16Array(
        buffer.buffer,
        buffer.byteOffset,
        buffer.length / 2
      );
      expect(pcm16[0]).toBe(0);
      expect(pcm16[1]).toBe(32767);
      expect(pcm16[2]).toBe(-32768);
    });

    it('converts number array to base64 PCM16', () => {
      const input = [0.5, -0.5];
      const result = convertToPCM16Base64(input, 16000);

      expect(result).not.toBeNull();

      const buffer = Buffer.from(result!, 'base64');
      const pcm16 = new Int16Array(
        buffer.buffer,
        buffer.byteOffset,
        buffer.length / 2
      );
      expect(pcm16[0]).toBe(16383);
      expect(pcm16[1]).toBe(-16384);
    });
  });
});
