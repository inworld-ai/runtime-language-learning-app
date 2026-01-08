/**
 * Graph Service
 *
 * Manages graph initialization and configuration export.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';

import {
  getConversationGraph,
  destroyConversationGraph,
  ConversationGraphWrapper,
} from '../graphs/conversation-graph.js';
import { getFlashcardGraph } from '../graphs/flashcard-graph.js';
import { getResponseFeedbackGraph } from '../graphs/response-feedback-graph.js';
import { DEFAULT_LANGUAGE_CODE } from '../config/languages.js';
import { serverLogger as logger } from '../utils/logger.js';
import { connections } from './state.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Reference to the initialized graph wrapper
let graphWrapper: ConversationGraphWrapper | null = null;

export function getGraphWrapper(): ConversationGraphWrapper | null {
  return graphWrapper;
}

export async function initializeGraph(): Promise<void> {
  const assemblyAIApiKey = process.env.ASSEMBLY_AI_API_KEY;
  if (!assemblyAIApiKey) {
    throw new Error('ASSEMBLY_AI_API_KEY environment variable is required');
  }

  logger.info('initializing_conversation_graph');
  graphWrapper = getConversationGraph({
    assemblyAIApiKey,
    connections,
    defaultLanguageCode: DEFAULT_LANGUAGE_CODE,
  });
  logger.info('conversation_graph_initialized');
}

export async function exportGraphConfigs(): Promise<void> {
  // Navigate from services/ to graphs/configs/
  const configDir = path.join(__dirname, '../graphs/configs');

  if (!existsSync(configDir)) {
    await mkdir(configDir, { recursive: true });
  }

  const graphs = [
    { id: 'flashcard-generation-graph', graph: getFlashcardGraph() },
    { id: 'response-feedback-graph', graph: getResponseFeedbackGraph() },
    ...(graphWrapper
      ? [{ id: 'lang-learning-conversation-graph', graph: graphWrapper.graph }]
      : []),
  ];

  for (const { id, graph } of graphs) {
    const filePath = path.join(configDir, `${id}.json`);
    await writeFile(filePath, graph.toJSON(), 'utf-8');
    logger.info({ graphId: id, path: filePath }, 'graph_config_exported');
  }
}

export async function destroyGraph(): Promise<void> {
  await destroyConversationGraph();
  graphWrapper = null;
}
