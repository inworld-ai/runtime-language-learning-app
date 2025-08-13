import { History, HistoryItemInterface } from '@inworld/runtime/core';

/**
 * Example query for knowledge retrieval
 */
export const EXAMPLE_QUERY = 'Tell me about Inworld characters';

/**
 * Create history items for knowledge examples
 */
export const HISTORY_ITEMS: HistoryItemInterface[] = [
  {
    name: 'User',
    utterance: EXAMPLE_QUERY,
  },
];

/**
 * Creates a History instance with example items for knowledge tests
 * @returns History instance with example items
 */
export function createExampleHistory() {
  return new History(HISTORY_ITEMS);
}

export const exampleRecords = [
  'Inworld AI is a platform for creating AI-driven virtual characters.',
  'Characters created with Inworld can understand natural language, generate responses, and remember conversations.',
  'Inworld uses machine learning models to create more natural and contextual interactions.',
];

export const knowledgeCompileConfig = {
  parsingConfig: {
    maxCharsPerChunk: 200,
    maxChunksPerDocument: 100,
  },
};
