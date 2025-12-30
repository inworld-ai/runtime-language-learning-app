import { CustomNode, ProcessContext } from '@inworld/runtime/graph';
import logger from '../../../logger';
import { formatSession, formatContext } from '../../../log-helpers';

import { ConnectionsMap, State } from '../../../types/index';

/**
 * StateUpdateNode updates the state with the LLM's response.
 *
 * This node:
 * - Receives the LLM output text
 * - Updates the connection state with the assistant message
 * - Marks the interaction as completed in the datastore
 * - Returns the updated state
 */
export class StateUpdateNode extends CustomNode {
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

  process(context: ProcessContext, llmOutput: string): State {
    const sessionId = context.getDatastore().get('sessionId') as string;
    logger.debug({ sessionId, llmOutputLength: llmOutput?.length }, `StateUpdateNode processing [length:${llmOutput?.length || 0}]`);

    // Get sessionId from dataStore (constant for graph execution)

    const connection = this.connections[sessionId];
    if (connection?.unloaded) {
      throw Error(`Session unloaded for sessionId:${sessionId}`);
    }
    if (!connection) {
      throw Error(`Failed to read connection for sessionId:${sessionId}`);
    }

    // Only add assistant message if there's actual content
    // When LLM returns tool calls only, llmOutput is empty string
    if (llmOutput && llmOutput.trim().length > 0) {
      logger.debug({ sessionId, content: llmOutput.substring(0, 100) }, `StateUpdateNode adding assistant message: "${llmOutput.substring(0, 50)}..."`);
      connection.state.messages.push({
        role: 'assistant',
        content: llmOutput,
        id: connection.state.interactionId,
      });
    } else {
      logger.debug({ sessionId }, 'StateUpdateNode skipping empty message (likely tool call only)');
    }

    const dataStore = context.getDatastore();
    dataStore.add('c' + connection.state.interactionId, '');
    logger.info({
      sessionId,
      interactionId: connection.state.interactionId,
    }, `StateUpdateNode marking interaction completed ${formatContext(sessionId, undefined, connection.state.interactionId)}`);

    return connection.state;
  }
}
