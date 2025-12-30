import { DataStreamWithMetadata } from '@inworld/runtime';
import { CustomNode, ProcessContext } from '@inworld/runtime/graph';
import logger from '../../../logger';
import { formatContext } from '../../../log-helpers';

import { InteractionInfo } from '../../../types/index';

/**
 * TranscriptExtractorNode extracts transcript information from
 * DataStreamWithMetadata (typically output from AssemblyAISTTNode)
 * and converts it to InteractionInfo for downstream processing.
 *
 * This is a helper node to bridge Assembly.AI STT output with
 * the rest of the graph that expects InteractionInfo.
 */
export class TranscriptExtractorNode extends CustomNode {
  constructor(props?: {
    id?: string;
    reportToClient?: boolean;
  }) {
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
    streamWithMetadata: DataStreamWithMetadata,
  ): InteractionInfo {
    const metadata = streamWithMetadata.getMetadata();
    const sessionId = context.getDatastore().get('sessionId') as string;

    // Extract transcript and related info from metadata
    const transcript = (metadata.transcript as string) || '';
    const interactionComplete =
      (metadata.interaction_complete as boolean) || false;
    const iteration = (metadata.iteration as number) || 1;
    const interactionId = String(metadata.interactionId || iteration);

    logger.info({
      sessionId,
      interactionId,
      iteration,
      interactionComplete,
      transcript,
    }, `TranscriptExtractor processing [iteration:${iteration}]: "${transcript?.substring(0, 50)}..."`);

    // Return InteractionInfo
    return {
      sessionId,
      interactionId: interactionId,
      text: transcript,
    };
  }

  async destroy(): Promise<void> {
    // No cleanup needed
  }
}
