/**
 * InteractionQueueNode manages the queue of user interactions.
 *
 * This node:
 * - Receives interaction info from STT processing
 * - Manages a queue of interactions to ensure sequential processing
 * - Prevents race conditions when multiple interactions arrive
 * - Returns TextInput when ready to process, or empty when waiting
 */

import { CustomNode, ProcessContext } from '@inworld/runtime/graph';
import { ConnectionsMap, InteractionInfo, State, TextInput } from '../../types/index.js';

export class InteractionQueueNode extends CustomNode {
  private connections: ConnectionsMap;

  constructor(props?: {
    id?: string;
    connections?: ConnectionsMap;
    reportToClient?: boolean;
  }) {
    super({
      id: props?.id || 'interaction-queue-node',
      reportToClient: props?.reportToClient,
    });
    this.connections = props?.connections || {};
  }

  process(
    context: ProcessContext,
    interactionInfo: InteractionInfo,
    state: State
  ): TextInput {
    const sessionId = interactionInfo.sessionId;
    console.log(
      `[InteractionQueue] Processing interaction ${interactionInfo.interactionId}`
    );

    // Get current voiceId from connection state
    const connection = this.connections[sessionId];
    const currentVoiceId = connection?.state?.voiceId || state?.voiceId;

    const dataStore = context.getDatastore();
    const QUEUED_PREFIX = 'q';
    const RUNNING_PREFIX = 'r';
    const COMPLETED_PREFIX = 'c';

    // Register interaction in the queue
    if (!dataStore.has(QUEUED_PREFIX + interactionInfo.interactionId)) {
      dataStore.add(
        QUEUED_PREFIX + interactionInfo.interactionId,
        interactionInfo.text
      );
      console.log(
        `[InteractionQueue] New interaction queued: ${interactionInfo.interactionId}`
      );
    }

    // Get all keys and categorize them
    const allKeys = dataStore.keys();
    const queuedIds: string[] = [];
    let completedCount = 0;
    let runningCount = 0;

    for (const key of allKeys) {
      if (key.startsWith(QUEUED_PREFIX)) {
        const idStr = key.substring(QUEUED_PREFIX.length);
        queuedIds.push(idStr);
      } else if (key.startsWith(COMPLETED_PREFIX)) {
        completedCount++;
      } else if (key.startsWith(RUNNING_PREFIX)) {
        runningCount++;
      }
    }

    // Sort queued IDs by iteration number
    queuedIds.sort((a, b) => {
      const getIteration = (id: string): number => {
        const hashIndex = id.indexOf('#');
        if (hashIndex === -1) return 0;
        const iter = parseInt(id.substring(hashIndex + 1), 10);
        return isNaN(iter) ? 0 : iter;
      };
      return getIteration(a) - getIteration(b);
    });

    console.log(
      `[InteractionQueue] State: queued=${queuedIds.length}, completed=${completedCount}, running=${runningCount}`
    );

    // Decide if we should start processing the next interaction
    if (queuedIds.length === 0) {
      console.log('[InteractionQueue] No interactions to process');
      return {
        text: '',
        sessionId: sessionId,
        interactionId: '',
        voiceId: currentVoiceId,
      };
    }

    if (queuedIds.length === completedCount) {
      console.log('[InteractionQueue] All interactions completed');
      return {
        text: '',
        sessionId: sessionId,
        interactionId: '',
        voiceId: currentVoiceId,
      };
    }

    // There are unprocessed interactions
    if (runningCount === completedCount) {
      // No interaction is currently running, start the next one
      const nextId = queuedIds[completedCount];
      const runningKey = RUNNING_PREFIX + nextId;

      // Try to mark as running
      if (dataStore.has(runningKey) || !dataStore.add(runningKey, '')) {
        console.log(
          `[InteractionQueue] Interaction ${nextId} already started`
        );
        return {
          text: '',
          sessionId: sessionId,
          interactionId: '',
          voiceId: currentVoiceId,
        };
      }

      const queuedText = dataStore.get(QUEUED_PREFIX + nextId) as string;
      if (!queuedText) {
        console.error(
          `[InteractionQueue] Failed to retrieve text for ${nextId}`
        );
        return {
          text: '',
          sessionId: sessionId,
          interactionId: '',
          voiceId: currentVoiceId,
        };
      }

      console.log(
        `[InteractionQueue] Starting LLM processing: "${queuedText.substring(0, 50)}..."`
      );

      return {
        text: queuedText,
        sessionId: sessionId,
        interactionId: nextId,
        voiceId: currentVoiceId,
      };
    } else {
      // An interaction is currently running, wait
      console.log(
        `[InteractionQueue] Waiting for interaction ${queuedIds[completedCount]}`
      );
      return {
        text: '',
        sessionId: sessionId,
        interactionId: '',
        voiceId: currentVoiceId,
      };
    }
  }
}

