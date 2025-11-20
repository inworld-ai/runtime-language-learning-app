import { v4 } from 'uuid';
import { Graph } from '@inworld/runtime/graph';
import { GraphTypes } from '@inworld/runtime/common';
import { UserContextInterface } from '@inworld/runtime/graph';
import { createFlashcardGraph } from '../graphs/flashcard-graph.js';

export interface Flashcard {
  id: string;
  spanish: string;
  english: string;
  example: string;
  mnemonic: string;
  timestamp: string;
}

export interface ConversationMessage {
  role: string;
  content: string;
}

export class FlashcardProcessor {
  private existingFlashcards: Flashcard[] = [];

  constructor() {
    // Initialize with empty flashcard array
  }

  async generateFlashcards(
    messages: ConversationMessage[],
    count: number = 1,
    userContext?: UserContextInterface
  ): Promise<Flashcard[]> {
    const executor = createFlashcardGraph();

    // Generate flashcards in parallel
    const promises: Promise<Flashcard>[] = [];

    for (let i = 0; i < count; i++) {
      promises.push(
        this.generateSingleFlashcard(executor, messages, userContext)
      );
    }

    try {
      const flashcards = await Promise.all(promises);

      // Filter out any failed generations and duplicates
      const validFlashcards = flashcards.filter(
        (card) => card.spanish && card.english
      );

      // Add to existing flashcards to track for future duplicates
      this.existingFlashcards.push(...validFlashcards);

      return validFlashcards;
    } catch (error) {
      console.error('Error generating flashcards:', error);
      return [];
    }
  }

  private async generateSingleFlashcard(
    executor: Graph,
    messages: ConversationMessage[],
    userContext?: UserContextInterface
  ): Promise<Flashcard> {
    try {
      const input = {
        studentName: 'Student',
        teacherName: 'Señor Rosales',
        messages: messages,
        flashcards: this.existingFlashcards,
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
          'Flashcard executor.start with ExecutionContext failed, falling back without context:',
          err
        );
        executionResult = await executor.start(input);
      }
      let finalData: GraphTypes.Content | null = null;
      for await (const res of executionResult.outputStream) {
        finalData = res.data;
      }
      const flashcard = finalData as unknown as Flashcard;

      // Check if this is a duplicate
      const isDuplicate = this.existingFlashcards.some(
        (existing) =>
          existing.spanish?.toLowerCase() === flashcard.spanish?.toLowerCase()
      );

      if (isDuplicate) {
        // Try to generate a different one by adding a random seed to the prompt
        // For simplicity, we'll just return an empty flashcard if duplicate
        return {
          id: v4(),
          spanish: '',
          english: '',
          example: '',
          mnemonic: '',
          timestamp: new Date().toISOString(),
        } as Flashcard & { error?: string };
      }

      return flashcard;
    } catch (error) {
      console.error('Error generating single flashcard:', error);
      return {
        id: v4(),
        spanish: '',
        english: '',
        example: '',
        mnemonic: '',
        timestamp: new Date().toISOString(),
      } as Flashcard & { error?: string };
    }
  }

  // Reset flashcards when starting a new conversation
  reset() {
    this.existingFlashcards = [];
  }

  // Get all existing flashcards
  getExistingFlashcards(): Flashcard[] {
    return this.existingFlashcards;
  }
}
