import { CustomNode, ProcessContext } from '@inworld/runtime/graph';
import logger from '../../../logger';
import { formatSession, formatContext } from '../../../log-helpers';

import { ConnectionsMap, InteractionInfo, State, TextInput } from '../../../types/index';

/**
 * InteractionQueueNode manages the queue of user interactions.
 *
 * This node:
 * - Receives interaction info from STT processing
 * - Manages a queue of interactions to ensure sequential processing
 * - Prevents race conditions when multiple interactions arrive
 * - Returns TextInput when ready to process, or empty when waiting
 *
 * Queue states tracked in datastore:
 * - 'q{id}': Queued interactions waiting to be processed
 * - 'r{id}': Running interactions currently being processed
 * - 'c{id}': Completed interactions
 */
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
    state: State,
  ): TextInput {
    const sessionId = interactionInfo.sessionId;
    logger.debug({ sessionId, interactionId: interactionInfo.interactionId }, 'InteractionQueueNode processing');
    
    // Get current voiceId from connection state (in case it was updated via session.update)
    const connection = this.connections[sessionId];
    const currentVoiceId = connection?.state?.voiceId || state?.voiceId;

    // ====================================================================
    // STEP 1-3: Store text and analyze queue state
    // ====================================================================
    const dataStore = context.getDatastore();
    const QUEUED_PREFIX = 'q';
    const RUNNING_PREFIX = 'r';
    const COMPLETED_PREFIX = 'c';

    // Register interaction in the queue
    if (!dataStore.has(QUEUED_PREFIX + interactionInfo.interactionId)) {
      // Store queued interaction
      dataStore.add(
        QUEUED_PREFIX + interactionInfo.interactionId,
        interactionInfo.text,
      );
      logger.info({ sessionId, interactionId: interactionInfo.interactionId }, 'InteractionQueue - New interaction queued');
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

    // Sort queued IDs - extract iteration number for sorting
    queuedIds.sort((a, b) => {
      const getIteration = (id: string): number => {
        const hashIndex = id.indexOf('#');
        if (hashIndex === -1) return 0;
        const iter = parseInt(id.substring(hashIndex + 1), 10);
        return isNaN(iter) ? 0 : iter;
      };
      return getIteration(a) - getIteration(b);
    });

    logger.debug({
      sessionId,
      queuedCount: queuedIds.length,
      completedCount,
      runningCount,
    }, 'InteractionQueue - State');

    // ====================================================================
    // STEP 4: Decide if we should start processing the next interaction
    // ====================================================================
    if (queuedIds.length === 0) {
      // No interactions to process yet
      logger.debug({ sessionId }, 'InteractionQueue - No interactions to process yet');
      return {
        text: '',
        sessionId: sessionId,
        interactionId: '',
        voiceId: currentVoiceId,
      } as TextInput;
    }

    if (queuedIds.length === completedCount) {
      // All interactions have been processed
      logger.debug({ sessionId }, 'InteractionQueue - All interactions completed');
      return {
        text: '',
        sessionId: sessionId,
        interactionId: '',
        voiceId: currentVoiceId,
      } as TextInput;
    }

    // There are unprocessed interactions
    if (runningCount === completedCount) {
      // No interaction is currently running, start the next one
      const nextId = queuedIds[completedCount];
      const runningKey = RUNNING_PREFIX + nextId;

      // NOTE: We do NOT skip interactions marked as "interrupted"
      // The "isInterrupted" flag means "this interaction caused an interruption of a previous response"
      // But the user's speech is still a valid request that should be processed!
      // All user speech should result in a response.

      // Try to mark as running (prevents race conditions)
      if (dataStore.has(runningKey) || !dataStore.add(runningKey, '')) {
        logger.debug({ sessionId, interactionId: nextId }, 'InteractionQueue - Interaction already started');
        return {
          text: '',
          sessionId: sessionId,
          interactionId: '',
          voiceId: currentVoiceId,
        } as TextInput;
      }

      const queuedText = dataStore.get(QUEUED_PREFIX + nextId) as string;
      if (!queuedText) {
        logger.error({ sessionId, interactionId: nextId }, 'InteractionQueue - Failed to retrieve text');
        return {
          text: '',
          sessionId: sessionId,
          interactionId: '',
          voiceId: currentVoiceId,
        } as TextInput;
      }

      logger.info({ sessionId, interactionId: nextId, text: queuedText.substring(0, 100) }, `InteractionQueue - Starting LLM processing: "${queuedText.substring(0, 50)}..."`);

      return {
        text: queuedText,
        sessionId: sessionId,
        interactionId: nextId,
        voiceId: currentVoiceId,
      } as TextInput;
    } else {
      // An interaction is currently running, wait for it to complete
      logger.debug({ sessionId, waitingForInteraction: queuedIds[completedCount] }, `InteractionQueue - Waiting for interaction [waiting for:${queuedIds[completedCount]}]`);
      return {
        text: '',
        sessionId: sessionId,
        interactionId: '',
        voiceId: currentVoiceId,
      } as TextInput;
    }
  }
}
