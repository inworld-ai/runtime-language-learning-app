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
      console.log(
        `FeedbackProcessor: Language changed to ${this.languageConfig.name}`
      );
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

    try {
      const input: ResponseFeedbackInput = {
        messages: messages,
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
        console.warn(
          'Feedback executor.start with ExecutionContext failed, falling back without context:',
          err
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
      console.error('Error generating feedback:', error);
      return '';
    }
  }

  reset() {
    // No state to reset for feedback processor
  }
}
