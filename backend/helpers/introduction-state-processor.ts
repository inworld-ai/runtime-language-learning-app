import { v4 as uuidv4 } from 'uuid';
import { createIntroductionStateGraph } from '../graphs/introduction-state-graph.ts';

export type IntroductionStateLevel = 'beginner' | 'intermediate' | 'advanced' | '';

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
  private state: IntroductionState = { name: '', level: '', goal: '', timestamp: '' };
  private executor: any;

  constructor() {
    this.executor = createIntroductionStateGraph();
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
    console.log('IntroductionStateProcessor - After merge, state is:', this.state);
  }

  async update(messages: ConversationMessage[]): Promise<IntroductionState> {
    try {
      const input = {
        messages,
        existingState: this.state,
      };

      console.log('IntroductionStateProcessor - Current state before update:', this.state);
      console.log('IntroductionStateProcessor - Messages for extraction:', messages);

      const outputStream = await this.executor.start(input, uuidv4());
      let finalData: any = null;
      for await (const res of outputStream) {
        finalData = res.data;
      }
      const parsed = finalData as IntroductionState;
      console.log('IntroductionStateProcessor - Extracted state:', parsed);
      this.mergeState(parsed);
      console.log('IntroductionStateProcessor - Merged state:', this.state);
      return this.state;
    } catch (error) {
      console.error('Error updating introduction state:', error);
      return this.state;
    }
  }
}


