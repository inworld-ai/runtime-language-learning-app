/**
 * TTSRequestBuilderNode builds a TTSRequest with dynamic voiceId.
 *
 * For long-running graphs, it reads voiceId from connection state at processing time
 * to ensure voice changes via language switching are reflected immediately.
 */

import { CustomNode, GraphTypes, ProcessContext } from '@inworld/runtime/graph';
import { ConnectionsMap } from '../../types/index.js';
import { getLanguageConfig } from '../../config/languages.js';

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
    _input: unknown,
    textStream: GraphTypes.TextStream
  ): GraphTypes.TTSRequest {
    const sessionId = context.getDatastore().get('sessionId') as string;

    // For long-running graphs, read voiceId from connection state at processing time
    const connection = this.connections[sessionId];

    // Get voice from state, or fall back to language config, or default
    let voiceId = connection?.state?.voiceId;
    if (!voiceId && connection?.state?.languageCode) {
      const langConfig = getLanguageConfig(connection.state.languageCode);
      voiceId = langConfig.ttsConfig.speakerId;
    }
    voiceId = voiceId || this.defaultVoiceId;

    console.log(`[TTSRequestBuilder] Building TTS request [voice:${voiceId}]`);

    return GraphTypes.TTSRequest.withStream(textStream, {
      id: voiceId,
    });
  }

  async destroy(): Promise<void> {
    // No cleanup needed
  }
}

