import { GraphTypes } from '@inworld/runtime/common';
import type { ChunkHandler, HandlerContext } from './types.ts';

/**
 * Handles TTS audio output stream
 */
export const handleTTSOutputStream: ChunkHandler<GraphTypes.TTSOutputStream> = async (
  ttsStreamIterator: GraphTypes.TTSOutputStream, 
  context: HandlerContext
) => {
  console.log('VAD Processing TTS audio stream...');
  let isFirstChunk = true;
  
  for await (const ttsChunk of ttsStreamIterator) {
    if (ttsChunk.audio && ttsChunk.audio.data) {
      // Log first chunk for latency tracking
      if (isFirstChunk) {
        console.log('Sending first TTS chunk immediately');
      }
      
      const audioData = new Float32Array(ttsChunk.audio.data);
      const int16Array = new Int16Array(audioData.length);
      for (let i = 0; i < audioData.length; i++) {
        int16Array[i] = Math.max(-32768, Math.min(32767, audioData[i] * 32767));
      }
      const base64Audio = Buffer.from(int16Array.buffer).toString('base64');
      
      // Send immediately without buffering
      context.sendWebSocketMessage({
        type: 'audio_stream',
        audio: base64Audio,
        sampleRate: ttsChunk.audio.sampleRate || 16000,
        timestamp: Date.now(),
        text: ttsChunk.text || '',
        isFirstChunk: isFirstChunk
      });
      
      // Mark that we've sent the first chunk
      isFirstChunk = false;
    }
  }
  
  // Send completion signal for iOS
  console.log('VAD TTS stream complete, sending completion signal');
  context.sendWebSocketMessage({
    type: 'audio_stream_complete',
    timestamp: Date.now()
  });
  
  // Now that TTS is complete, trigger flashcard generation and other post-processing
  if (context.transcription && context.llmResponse) {
    console.log('Triggering flashcard generation after TTS completion');
    
    // Send conversation update and trigger flashcard generation
    context.triggerFlashcardGeneration();
    
    // Run introduction-state extraction while incomplete
    context.triggerIntroductionStateExtraction();
  }
};
