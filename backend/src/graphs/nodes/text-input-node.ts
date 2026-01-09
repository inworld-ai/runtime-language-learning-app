/**
 * TextInputNode updates the state with the user's input this turn.
 *
 * This node:
 * - Receives user text input with interaction and session IDs
 * - Updates the connection state with the user message
 * - Returns the updated state for downstream processing
 */

import { CustomNode, ProcessContext } from '@inworld/runtime/graph';
import { v4 as uuidv4 } from 'uuid';
import { ConnectionsMap, State, TextInput } from '../../types/index.js';
import { graphLogger as logger } from '../../utils/logger.js';

export class TextInputNode extends CustomNode {
  private connections: ConnectionsMap;

  constructor(props: {
    id: string;
    connections: ConnectionsMap;
    reportToClient?: boolean;
  }) {
    super({
      id: props.id,
      reportToClient: props.reportToClient,
    });
    this.connections = props.connections;
  }

  process(_context: ProcessContext, input: TextInput): State {
    logger.debug(
      { textSnippet: input.text?.substring(0, 50) },
      'text_input_processing'
    );

    const { text, interactionId, sessionId } = input;

    const connection = this.connections[sessionId];
    if (connection?.unloaded) {
      throw Error(`Session unloaded for sessionId:${sessionId}`);
    }
    if (!connection) {
      throw Error(`Failed to read connection for sessionId:${sessionId}`);
    }
    const state = connection.state;
    if (!state) {
      throw Error(
        `Failed to read state from connection for sessionId:${sessionId}`
      );
    }

    // Update interactionId
    connection.state.interactionId = interactionId;

    // Add user message to conversation
    connection.state.messages.push({
      role: 'user',
      content: text,
      id: interactionId || uuidv4(),
      timestamp: new Date().toISOString(),
    });

    return connection.state;
  }
}
