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
import {
  ConnectionsMap,
  InteractionInfo,
  State,
  TextInput,
} from '../../types/index.js';
import { graphLogger as logger } from '../../utils/logger.js';

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
    logger.debug(
      { interactionId: interactionInfo.interactionId },
      'processing_interaction'
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
      logger.debug(
        { interactionId: interactionInfo.interactionId },
        'interaction_queued'
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

    logger.debug(
      {
        queued: queuedIds.length,
        completed: completedCount,
        running: runningCount,
      },
      'queue_state'
    );

    // Decide if we should start processing the next interaction
    if (queuedIds.length === 0) {
      logger.debug('no_interactions_to_process');
      return {
        text: '',
        sessionId: sessionId,
        interactionId: '',
        voiceId: currentVoiceId,
      };
    }

    if (queuedIds.length === completedCount) {
      logger.debug('all_interactions_completed');
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
        logger.debug({ interactionId: nextId }, 'interaction_already_started');
        return {
          text: '',
          sessionId: sessionId,
          interactionId: '',
          voiceId: currentVoiceId,
        };
      }

      const queuedText = dataStore.get(QUEUED_PREFIX + nextId) as string;
      if (!queuedText) {
        logger.error({ interactionId: nextId }, 'failed_to_retrieve_text');
        return {
          text: '',
          sessionId: sessionId,
          interactionId: '',
          voiceId: currentVoiceId,
        };
      }

      logger.debug(
        { textSnippet: queuedText.substring(0, 50) },
        'starting_llm_processing'
      );

      return {
        text: queuedText,
        sessionId: sessionId,
        interactionId: nextId,
        voiceId: currentVoiceId,
      };
    } else {
      // An interaction is currently running, wait
      logger.debug(
        { waitingFor: queuedIds[completedCount] },
        'waiting_for_interaction'
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
