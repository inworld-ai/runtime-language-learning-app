/**
 * StateUpdateNode updates the state with the LLM's response.
 *
 * This node:
 * - Receives the LLM output text
 * - Updates the connection state with the assistant message
 * - Marks the interaction as completed in the datastore
 * - Returns the updated state
 */

import { CustomNode, ProcessContext } from '@inworld/runtime/graph';
import { v4 as uuidv4 } from 'uuid';
import { ConnectionsMap, State } from '../../types/index.js';

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
    console.log(
      `[StateUpdateNode] Processing [length:${llmOutput?.length || 0}]`
    );

    const connection = this.connections[sessionId];
    if (connection?.unloaded) {
      throw Error(`Session unloaded for sessionId:${sessionId}`);
    }
    if (!connection) {
      throw Error(`Failed to read connection for sessionId:${sessionId}`);
    }

    // Only add assistant message if there's actual content
    if (llmOutput && llmOutput.trim().length > 0) {
      console.log(
        `[StateUpdateNode] Adding assistant message: "${llmOutput.substring(0, 50)}..."`
      );
      connection.state.messages.push({
        role: 'assistant',
        content: llmOutput,
        id: connection.state.interactionId || uuidv4(),
        timestamp: new Date().toISOString(),
      });
    } else {
      console.log('[StateUpdateNode] Skipping empty message');
    }

    // Mark interaction as completed
    const dataStore = context.getDatastore();
    dataStore.add('c' + connection.state.interactionId, '');
    console.log(
      `[StateUpdateNode] Marked interaction ${connection.state.interactionId} as completed`
    );

    return connection.state;
  }
}

