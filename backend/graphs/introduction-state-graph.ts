import 'dotenv/config';
import {
  GraphBuilder,
  CustomNode,
  ProcessContext,
  RemoteLLMChatNode,
  Graph,
} from '@inworld/runtime/graph';
import { GraphTypes } from '@inworld/runtime/common';
import { PromptBuilder } from '@inworld/runtime/primitives/llm';
import { introductionStatePromptTemplate } from '../helpers/prompt-templates.js';
import {
  LanguageConfig,
  getLanguageConfig,
  DEFAULT_LANGUAGE_CODE,
} from '../config/languages.js';

type IntroductionStateLevel = 'beginner' | 'intermediate' | 'advanced' | '';

export interface IntroductionState {
  name: string;
  level: IntroductionStateLevel;
  goal: string;
  timestamp: string;
}

class IntroductionPromptBuilderNode extends CustomNode {
  async process(
    _context: ProcessContext,
    input: GraphTypes.Content | Record<string, unknown>
  ) {
    const builder = await PromptBuilder.create(introductionStatePromptTemplate);
    const renderedPrompt = await builder.build(input as Record<string, unknown>);
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

/**
 * Normalize level strings from various languages to standard values
 * Supports: English, Spanish, Japanese, French (and more can be added)
 */
function normalizeLevel(level: unknown): IntroductionStateLevel {
  if (typeof level !== 'string') return '';
  const lower = level
    .trim()
    .toLowerCase()
    .replace(/[.!?,;:]+$/g, '');

  const mapping: Record<string, IntroductionStateLevel> = {
    // English
    beginner: 'beginner',
    intermediate: 'intermediate',
    advanced: 'advanced',
    // Spanish
    principiante: 'beginner',
    intermedio: 'intermediate',
    avanzado: 'advanced',
    // French
    débutant: 'beginner',
    debutant: 'beginner',
    intermédiaire: 'intermediate',
    intermediaire: 'intermediate',
    avancé: 'advanced',
    avance: 'advanced',
    // Japanese (romanji)
    shoshinsha: 'beginner',
    chūkyū: 'intermediate',
    chuukyuu: 'intermediate',
    jōkyū: 'advanced',
    joukyuu: 'advanced',
    // Japanese (hiragana/katakana - common responses)
    初心者: 'beginner',
    中級: 'intermediate',
    上級: 'advanced',
    // Additional variations
    basic: 'beginner',
    elementary: 'beginner',
    beginning: 'beginner',
    middle: 'intermediate',
    medium: 'intermediate',
    expert: 'advanced',
    fluent: 'advanced',
  };

  return mapping[lower] || '';
}

class IntroductionStateParserNode extends CustomNode {
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
      console.log(
        'IntroductionStateParserNode - Raw LLM response:',
        textContent
      );

      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        console.log('IntroductionStateParserNode - Parsed JSON:', parsed);

        const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
        const level = normalizeLevel(parsed.level);
        const goal = typeof parsed.goal === 'string' ? parsed.goal.trim() : '';
        const state: IntroductionState = {
          name,
          level,
          goal,
          timestamp: new Date().toISOString(),
        };
        console.log('IntroductionStateParserNode - Returning state:', state);
        return state;
      }
    } catch (error) {
      console.error('Failed to parse introduction state JSON:', error);
    }

    const fallback: IntroductionState = {
      name: '',
      level: '',
      goal: '',
      timestamp: new Date().toISOString(),
    };
    console.log('IntroductionStateParserNode - Returning fallback state');
    return fallback;
  }
}

/**
 * Create an introduction state extraction graph for a specific language
 */
function createIntroductionStateGraphForLanguage(
  languageConfig: LanguageConfig
): Graph {
  const apiKey = process.env.INWORLD_API_KEY;
  if (!apiKey) {
    throw new Error('INWORLD_API_KEY environment variable is required');
  }

  const promptBuilderNode = new IntroductionPromptBuilderNode({
    id: 'introduction-prompt-builder',
  });
  const textToChatRequestNode = new TextToChatRequestNode({
    id: 'text-to-chat-request',
  });
  const llmNode = new RemoteLLMChatNode({
    id: 'llm_node',
    provider: 'openai',
    modelName: 'gpt-4o-mini',
    stream: false,
  });
  const parserNode = new IntroductionStateParserNode({
    id: 'introduction-state-parser',
  });

  const executor = new GraphBuilder({
    id: `introduction-state-graph-${languageConfig.code}`,
    enableRemoteConfig: false,
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

  return executor;
}

// Cache for language-specific introduction state graphs
const introductionStateGraphCache = new Map<string, Graph>();

/**
 * Get or create an introduction state graph for a specific language
 */
export function getIntroductionStateGraph(
  languageCode: string = DEFAULT_LANGUAGE_CODE
): Graph {
  if (!introductionStateGraphCache.has(languageCode)) {
    const languageConfig = getLanguageConfig(languageCode);
    console.log(
      `Creating introduction state graph for language: ${languageConfig.name} (${languageCode})`
    );
    const graph = createIntroductionStateGraphForLanguage(languageConfig);
    introductionStateGraphCache.set(languageCode, graph);
  }

  return introductionStateGraphCache.get(languageCode)!;
}

/**
 * Legacy function for backwards compatibility
 */
export function createIntroductionStateGraph(): Graph {
  return getIntroductionStateGraph(DEFAULT_LANGUAGE_CODE);
}
