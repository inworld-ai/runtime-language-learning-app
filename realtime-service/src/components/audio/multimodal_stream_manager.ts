import { AudioChunkInterface } from '@inworld/runtime/common';
import { GraphTypes } from '@inworld/runtime/graph';

import logger from '../../logger';

/**
 * Manages a stream of multimodal content (audio and/or text) that can be fed
 * asynchronously as data arrives from websocket connections.
 *
 * This unifies audio and text streaming into a single interface that always
 * yields MultimodalContent, making it compatible with entry node routing.
 */
export class MultimodalStreamManager {
  private queue: GraphTypes.MultimodalContent[] = [];
  private waitingResolvers: Array<
    (value: IteratorResult<GraphTypes.MultimodalContent>) => void
  > = [];
  private ended = false;

  /**
   * Add an audio chunk to the stream (wrapped in MultimodalContent)
   */
  pushAudio(chunk: AudioChunkInterface): void {
    if (this.ended) {
      return;
    }

    // Create GraphTypes.Audio object and wrap in MultimodalContent
    const audioData = new GraphTypes.Audio({
      data: Array.isArray(chunk.data) ? chunk.data : Array.from(chunk.data),
      sampleRate: chunk.sampleRate,
    });
    const multimodalContent = new GraphTypes.MultimodalContent({
      audio: audioData,
    });

    this.pushContent(multimodalContent);
  }

  /**
   * Add text to the stream (wrapped in MultimodalContent)
   */
  pushText(text: string): void {
    if (this.ended) {
      return;
    }

    const multimodalContent = new GraphTypes.MultimodalContent({ text });
    this.pushContent(multimodalContent);
  }

  /**
   * Internal method to push MultimodalContent to the stream
   */
  private pushContent(content: GraphTypes.MultimodalContent): void {
    // If there are waiting consumers, resolve immediately
    if (this.waitingResolvers.length > 0) {
      const resolve = this.waitingResolvers.shift()!;
      resolve({ value: content, done: false });
    } else {
      // Otherwise, queue the content
      this.queue.push(content);
    }
  }

  /**
   * Mark the stream as ended
   */
  end(): void {
    logger.info('[MultimodalStreamManager] Ending stream');
    this.ended = true;

    // Resolve all waiting consumers with done signal
    while (this.waitingResolvers.length > 0) {
      const resolve = this.waitingResolvers.shift()!;
      resolve({ value: undefined as any, done: true });
    }
  }

  /**
   * Create an async iterator for the stream
   */
  async *createStream(): AsyncIterableIterator<GraphTypes.MultimodalContent> {
    while (true) {
      // If stream ended and queue is empty, we're done
      if (this.ended && this.queue.length === 0) {
        logger.info('[MultimodalStreamManager] Stream iteration complete');
        return;
      }

      // If we have queued content, yield it immediately
      if (this.queue.length > 0) {
        const content = this.queue.shift()!;
        yield content;
        continue;
      }

      // If stream ended but we just exhausted the queue, we're done
      if (this.ended) {
        logger.info('[MultimodalStreamManager] Stream iteration complete');
        return;
      }

      // Otherwise, wait for new content
      const result = await new Promise<
        IteratorResult<GraphTypes.MultimodalContent>
      >((resolve) => {
        this.waitingResolvers.push(resolve);
      });

      if (result.done) {
        return;
      }

      yield result.value;
    }
  }

  /**
   * Check if the stream has ended
   */
  isEnded(): boolean {
    return this.ended;
  }
}
