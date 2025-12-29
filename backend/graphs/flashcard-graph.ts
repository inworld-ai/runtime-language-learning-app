import 'dotenv/config';
import fs from 'fs';

import {
  GraphBuilder,
  CustomNode,
  ProcessContext,
  RemoteLLMChatNode,
  Graph,
} from '@inworld/runtime/graph';
import { GraphTypes } from '@inworld/runtime/common';
import { renderJinja } from '@inworld/runtime/primitives/llm';
import { flashcardPromptTemplate } from '../helpers/prompt-templates.js';
import { v4 } from 'uuid';
import { Flashcard } from '../helpers/flashcard-processor.js';
import {
  LanguageConfig,
  getLanguageConfig,
  DEFAULT_LANGUAGE_CODE,
} from '../config/languages.js';

class FlashcardPromptBuilderNode extends CustomNode {
  async process(
    _context: ProcessContext,
    input: GraphTypes.Content | Record<string, unknown>
  ) {
    const renderedPrompt = await renderJinja(
      flashcardPromptTemplate,
      JSON.stringify(input)
    );
    return renderedPrompt;
  }
}

class TextToChatRequestNode extends CustomNode {
  process(_context: ProcessContext, renderedPrompt: string) {
    return new GraphTypes.LLMChatRequest({
      messages: [{ role: 'user', content: renderedPrompt }],
    });
  }
}

class FlashcardParserNode extends CustomNode {
  process(_context: ProcessContext, input: GraphTypes.Content) {
    try {
      const content =
        (input &&
          typeof input === 'object' &&
          'content' in input &&
          (input as { content?: unknown }).content) ||
        input;
      const textContent =
        typeof content === 'string' ? content : JSON.stringify(content);

      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          id: v4(),
          // Support both new 'targetWord' format and legacy 'spanish' format
          targetWord: parsed.targetWord ?? parsed.spanish ?? '',
          english: parsed.english ?? '',
          example: parsed.example ?? '',
          mnemonic: parsed.mnemonic ?? '',
          timestamp: new Date().toISOString(),
        };
      }
    } catch (error) {
      console.error('Failed to parse flashcard JSON:', error);
    }

    return {
      id: v4(),
      targetWord: '',
      english: '',
      example: '',
      mnemonic: '',
      timestamp: new Date().toISOString(),
      error: 'Failed to generate flashcard',
    } as Flashcard;
  }
}

/**
 * Creates a flashcard generation graph for a specific language
 */
function createFlashcardGraphForLanguage(languageConfig: LanguageConfig): Graph {
  const apiKey = process.env.INWORLD_API_KEY;
  if (!apiKey) {
    throw new Error('INWORLD_API_KEY environment variable is required');
  }

  const promptBuilderNode = new FlashcardPromptBuilderNode({
    id: 'flashcard-prompt-builder',
  });
  const textToChatRequestNode = new TextToChatRequestNode({
    id: 'text-to-chat-request',
  });
  const llmNode = new RemoteLLMChatNode({
    id: 'llm_node',
    provider: 'openai',
    modelName: 'gpt-5',
    stream: false,
    textGenerationConfig: {
      maxNewTokens: 2500,
      maxPromptLength: 100,
      repetitionPenalty: 1,
      topP: 1,
      temperature: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
    },
  });
  const parserNode = new FlashcardParserNode({ id: 'flashcard-parser' });

  const executor = new GraphBuilder({
    id: `flashcard-generation-graph-${languageConfig.code}`,
    enableRemoteConfig: true,
  })
    .addNode(promptBuilderNode)
    .addNode(textToChatRequestNode)
    .addNode(llmNode)
    .addNode(parserNode)
    .addEdge(promptBuilderNode, textToChatRequestNode)
    .addEdge(textToChatRequestNode, llmNode)
    .addEdge(llmNode, parserNode)
    .setStartNode(promptBuilderNode)
    .setEndNode(parserNode)
    .build();

  // Only write debug file for default language to avoid cluttering
  if (languageConfig.code === DEFAULT_LANGUAGE_CODE) {
    fs.writeFileSync('flashcard-graph.json', executor.toJSON());
  }

  return executor;
}

// Cache for language-specific flashcard graphs
const flashcardGraphCache = new Map<string, Graph>();

/**
 * Get or create a flashcard graph for a specific language
 */
export function getFlashcardGraph(
  languageCode: string = DEFAULT_LANGUAGE_CODE
): Graph {
  if (!flashcardGraphCache.has(languageCode)) {
    const languageConfig = getLanguageConfig(languageCode);
    console.log(
      `Creating flashcard graph for language: ${languageConfig.name} (${languageCode})`
    );
    const graph = createFlashcardGraphForLanguage(languageConfig);
    flashcardGraphCache.set(languageCode, graph);
  }

  return flashcardGraphCache.get(languageCode)!;
}

/**
 * Legacy function for backwards compatibility
 */
export function createFlashcardGraph(): Graph {
  return getFlashcardGraph(DEFAULT_LANGUAGE_CODE);
}
