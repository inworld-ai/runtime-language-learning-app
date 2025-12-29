import { v4 as uuidv4 } from 'uuid';
import { Graph } from '@inworld/runtime/graph';
import { GraphTypes } from '@inworld/runtime/common';
import { getIntroductionStateGraph } from '../graphs/introduction-state-graph.js';
import {
  LanguageConfig,
  getLanguageConfig,
  DEFAULT_LANGUAGE_CODE,
} from '../config/languages.js';

export type IntroductionStateLevel =
  | 'beginner'
  | 'intermediate'
  | 'advanced'
  | '';

export interface IntroductionState {
  name: string;
  level: IntroductionStateLevel;
  goal: string;
  timestamp: string;
}

export interface ConversationMessage {
  role: string;
  content: string;
}

export class IntroductionStateProcessor {
  private state: IntroductionState = {
    name: '',
    level: '',
    goal: '',
    timestamp: '',
  };
  private executor: Graph;
  private languageCode: string = DEFAULT_LANGUAGE_CODE;
  private languageConfig: LanguageConfig;

  constructor(languageCode: string = DEFAULT_LANGUAGE_CODE) {
    this.languageCode = languageCode;
    this.languageConfig = getLanguageConfig(languageCode);
    this.executor = getIntroductionStateGraph(languageCode);
  }

  /**
   * Update the language for this processor
   */
  setLanguage(languageCode: string): void {
    if (this.languageCode !== languageCode) {
      this.languageCode = languageCode;
      this.languageConfig = getLanguageConfig(languageCode);
      this.executor = getIntroductionStateGraph(languageCode);
      console.log(
        `IntroductionStateProcessor: Language changed to ${this.languageConfig.name}`
      );
    }
  }

  /**
   * Get current language code
   */
  getLanguageCode(): string {
    return this.languageCode;
  }

  isComplete(): boolean {
    return Boolean(this.state.name && this.state.level && this.state.goal);
  }

  getState(): IntroductionState {
    return this.state;
  }

  private mergeState(newState: IntroductionState) {
    const merged: IntroductionState = { ...this.state };
    // Only update fields if they have a non-empty value in the new state
    // This preserves existing values when the LLM returns empty strings
    if (newState.name && newState.name.trim()) {
      merged.name = newState.name.trim();
    }
    if (newState.level && newState.level.trim()) {
      merged.level = newState.level as IntroductionStateLevel;
    }
    if (newState.goal && newState.goal.trim()) {
      merged.goal = newState.goal.trim();
    }
    merged.timestamp = new Date().toISOString();
    this.state = merged;
    console.log(
      'IntroductionStateProcessor - After merge, state is:',
      this.state
    );
  }

  async update(messages: ConversationMessage[]): Promise<IntroductionState> {
    try {
      const input = {
        messages,
        existingState: this.state,
        target_language: this.languageConfig.name,
      };

      console.log(
        'IntroductionStateProcessor - Current state before update:',
        this.state
      );
      console.log(
        'IntroductionStateProcessor - Messages for extraction:',
        messages
      );

      const executionContext = {
        executionId: uuidv4(),
      };
      const executionResult = await this.executor.start(
        input,
        executionContext
      );
      let finalData: GraphTypes.Content | null = null;
      for await (const res of executionResult.outputStream) {
        finalData = res.data;
      }
      const parsed = finalData as unknown as IntroductionState;
      console.log('IntroductionStateProcessor - Extracted state:', parsed);
      this.mergeState(parsed);
      console.log('IntroductionStateProcessor - Merged state:', this.state);
      return this.state;
    } catch (error) {
      console.error('Error updating introduction state:', error);
      return this.state;
    }
  }

  reset() {
    this.state = {
      name: '',
      level: '',
      goal: '',
      timestamp: '',
    };
    console.log('IntroductionStateProcessor: State reset');
  }
}
