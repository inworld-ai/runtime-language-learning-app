import { v4 } from 'uuid';
import { createFlashcardGraph } from '../graphs/flashcard-graph.ts';

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
    count: number = 1
  ): Promise<Flashcard[]> {
    const graph = createFlashcardGraph();
    const executor = graph.getExecutor({
      disableRemoteConfig: true,
    });
    
    // Generate flashcards in parallel
    const promises: Promise<Flashcard>[] = [];
    
    for (let i = 0; i < count; i++) {
      promises.push(this.generateSingleFlashcard(executor, messages));
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
    executor: any,
    messages: ConversationMessage[]
  ): Promise<Flashcard> {
    try {
      const input = {
        studentName: 'Student',
        teacherName: 'Señor Rosales',
        messages: messages,
        flashcards: this.existingFlashcards
      };

      const outputStream = await executor.execute(input, v4());
      let result = await outputStream.next();
      
      // Get the final result (the parsed flashcard)
      while (!result.done) {
        const nextResult = await outputStream.next();
        if (!nextResult.done) {
          result = nextResult;
        } else {
          break;
        }
      }
      
      const flashcard = result.data as Flashcard;
      
      // Check if this is a duplicate
      const isDuplicate = this.existingFlashcards.some(
        existing => existing.spanish?.toLowerCase() === flashcard.spanish?.toLowerCase()
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
          error: 'Duplicate flashcard'
        } as any;
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
        error: error instanceof Error ? error.message : 'Unknown error'
      } as any;
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