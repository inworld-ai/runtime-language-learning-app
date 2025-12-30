import { CustomNode, GraphTypes, ProcessContext } from '@inworld/runtime/graph';
import logger from '../../../logger';
import { formatSession } from '../../../log-helpers';
import { ConnectionsMap } from '../../../types/index';

/**
 * TTSRequestBuilderNode builds a TTSRequest with dynamic voiceId.
 * For long-running graphs, it reads voiceId from connection state at processing time
 * to ensure voice changes via session.update are reflected immediately.
 */
export class TTSRequestBuilderNode extends CustomNode {
  private connections: ConnectionsMap;
  private defaultVoiceId: string;

  constructor(props: {
    id: string;
    connections: ConnectionsMap;
    defaultVoiceId: string;
    reportToClient?: boolean;
  }) {
    super({
      id: props.id,
      reportToClient: props.reportToClient,
    });
    this.connections = props.connections;
    this.defaultVoiceId = props.defaultVoiceId;
  }

  /**
   * Build a TTSRequest with the current voiceId from connection state
   * Receives two inputs:
   * 1. input - Graph input with sessionId (TextInput or State)
   * 2. textStream - The text stream from TextChunkingNode
   */
  process(
    context: ProcessContext,
    input: any,
    textStream: GraphTypes.TextStream,
  ): GraphTypes.TTSRequest {
    const sessionId = context.getDatastore().get('sessionId') as string;
    
    // For long-running graphs, read voiceId from connection state at processing time
    // This ensures voice changes via session.update are immediately reflected
    const connection = this.connections[sessionId];
    const voiceId = connection?.state?.voiceId || input?.voiceId || this.defaultVoiceId;
    
    logger.debug({
      sessionId,
      voiceId,
      connectionVoiceId: connection?.state?.voiceId,
      inputVoiceId: input?.voiceId,
      defaultVoiceId: this.defaultVoiceId,
    }, `TTSRequestBuilder building request [voice:${voiceId}]`);

    return GraphTypes.TTSRequest.withStream(textStream, {
      id: voiceId
    });
  }

  async destroy(): Promise<void> {
    // No cleanup needed
  }
}

