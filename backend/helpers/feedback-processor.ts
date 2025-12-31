import { v4 } from 'uuid';
import { GraphTypes } from '@inworld/runtime/common';
import { UserContextInterface } from '@inworld/runtime/graph';
import {
  getResponseFeedbackGraph,
  ResponseFeedbackInput,
} from '../graphs/response-feedback-graph.js';
import {
  LanguageConfig,
  getLanguageConfig,
  DEFAULT_LANGUAGE_CODE,
} from '../config/languages.js';
import { feedbackLogger as logger } from '../utils/logger.js';

export interface ConversationMessage {
  role: string;
  content: string;
}

export class FeedbackProcessor {
  private languageCode: string = DEFAULT_LANGUAGE_CODE;
  private languageConfig: LanguageConfig;

  constructor(languageCode: string = DEFAULT_LANGUAGE_CODE) {
    this.languageCode = languageCode;
    this.languageConfig = getLanguageConfig(languageCode);
  }

  setLanguage(languageCode: string): void {
    if (this.languageCode !== languageCode) {
      this.languageCode = languageCode;
      this.languageConfig = getLanguageConfig(languageCode);
      logger.info({ language: this.languageConfig.name }, 'language_changed');
    }
  }

  getLanguageCode(): string {
    return this.languageCode;
  }

  async generateFeedback(
    messages: ConversationMessage[],
    currentTranscript: string,
    userContext?: UserContextInterface
  ): Promise<string> {
    const executor = getResponseFeedbackGraph();

    // Remove the last assistant message so conversation ends with user's utterance
    let conversationMessages = messages;
    if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
      conversationMessages = messages.slice(0, -1);
    }

    try {
      const input: ResponseFeedbackInput = {
        messages: conversationMessages,
        currentTranscript: currentTranscript,
        targetLanguage: this.languageConfig.name,
      };

      let executionResult;
      try {
        const executionContext = {
          executionId: v4(),
          userContext: userContext,
        };
        executionResult = await executor.start(input, executionContext);
      } catch (err) {
        logger.warn(
          { err },
          'executor_start_with_context_failed_falling_back'
        );
        executionResult = await executor.start(input);
      }

      let finalData: GraphTypes.Content | null = null;
      for await (const res of executionResult.outputStream) {
        finalData = res.data;
      }

      const feedback = finalData as unknown as string;
      return feedback || '';
    } catch (error) {
      logger.error({ err: error }, 'feedback_generation_error');
      return '';
    }
  }

  reset() {
    // No state to reset for feedback processor
  }
}
