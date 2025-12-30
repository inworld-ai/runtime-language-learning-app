import { CustomNode, ProcessContext } from '@inworld/runtime/graph';
import logger from '../../../logger';
import { formatSession } from '../../../log-helpers';

import { ConnectionsMap, State, TextInput } from '../../../types/index';
import { TOOL_CALL_CONTINUATION_MARKER } from '../realtime_graph_executor';

/**
 * TextInputNode updates the state with the user's input this turn.
 *
 * This node:
 * - Receives user text input with interaction and session IDs
 * - Updates the connection state with the user message
 * - Returns the updated state for downstream processing
 * 
 * Special handling for tool call continuation:
 * - When text is TOOL_CALL_CONTINUATION_MARKER, this is a continuation after a tool call
 * - In this case, we DON'T add a new user message (tool result is already in messages)
 * - We just return the current state to trigger the LLM with existing conversation
 */
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

  process(context: ProcessContext, input: TextInput): State {
    logger.debug({ sessionId: input.sessionId, text: input.text?.substring(0, 100) }, `TextInputNode processing: "${input.text?.substring(0, 50)}..."`);

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
        `Failed to read state from connection for sessionId:${sessionId}`,
      );
    }

    // Update interactionId
    connection.state.interactionId = interactionId;

    // Check if this is a tool call continuation
    // If so, the tool result is already in messages (added by createConversationItem)
    // We skip adding a new user message and just return the state to continue the conversation
    if (text === TOOL_CALL_CONTINUATION_MARKER) {
      logger.info({ sessionId, interactionId }, 'TextInputNode: Tool call continuation - skipping user message, continuing with existing conversation');
      return connection.state;
    }

    // Normal flow: add user message to conversation
    connection.state.messages.push({
      role: 'user',
      content: text,
      id: interactionId,
    });

    return connection.state;
  }
}
