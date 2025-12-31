/**
 * TranscriptExtractorNode extracts transcript information from
 * DataStreamWithMetadata (output from AssemblyAISTTNode) and converts
 * it to InteractionInfo for downstream processing.
 */

import { DataStreamWithMetadata } from '@inworld/runtime';
import { CustomNode, ProcessContext } from '@inworld/runtime/graph';
import { InteractionInfo } from '../../types/index.js';

export class TranscriptExtractorNode extends CustomNode {
  constructor(props?: { id?: string; reportToClient?: boolean }) {
    super({
      id: props?.id || 'transcript-extractor-node',
      reportToClient: props?.reportToClient,
    });
  }

  /**
   * Extract transcript from metadata and return as InteractionInfo
   */
  process(
    context: ProcessContext,
    streamWithMetadata: DataStreamWithMetadata
  ): InteractionInfo {
    const metadata = streamWithMetadata.getMetadata();
    const sessionId = context.getDatastore().get('sessionId') as string;

    // Extract transcript and related info from metadata
    const transcript = (metadata.transcript as string) || '';
    const interactionComplete =
      (metadata.interaction_complete as boolean) || false;
    const iteration = (metadata.iteration as number) || 1;
    const interactionId = String(metadata.interactionId || iteration);

    console.log(
      `[TranscriptExtractor] Processing [iteration:${iteration}]: "${transcript?.substring(0, 50)}..." [complete:${interactionComplete}]`
    );

    return {
      sessionId,
      interactionId: interactionId,
      text: transcript,
      interactionComplete,
    };
  }

  async destroy(): Promise<void> {
    // No cleanup needed
  }
}
