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
    if (newState.name) merged.name = newState.name;
    if (newState.level) merged.level = newState.level;
    if (newState.goal) merged.goal = newState.goal;
    merged.timestamp = new Date().toISOString();
    this.state = merged;
  }

  async update(messages: ConversationMessage[]): Promise<IntroductionState> {
    try {
      const input = {
        messages,
        existingState: this.state,
      };

      const outputStream = await this.executor.start(input, uuidv4());
      let finalData: any = null;
      for await (const res of outputStream) {
        finalData = res.data;
      }
      const parsed = finalData as IntroductionState;
      this.mergeState(parsed);
      return this.state;
    } catch (error) {
      console.error('Error updating introduction state:', error);
      return this.state;
    }
  }
}


