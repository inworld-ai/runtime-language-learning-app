import 'dotenv/config';
import { GraphBuilder, CustomNode, ProcessContext, RemoteLLMChatNode } from '@inworld/runtime/graph';
import { GraphTypes } from '@inworld/runtime/common';
import { renderJinja } from '@inworld/runtime/primitives/llm';
import { introductionStatePromptTemplate } from '../helpers/prompt-templates.ts';

type IntroductionStateLevel = 'beginner' | 'intermediate' | 'advanced' | '';

export interface IntroductionState {
  name: string;
  level: IntroductionStateLevel;
  goal: string;
  timestamp: string;
}

class IntroductionPromptBuilderNode extends CustomNode {
  async process(_context: ProcessContext, input: any) {
    const renderedPrompt = await renderJinja(
      introductionStatePromptTemplate,
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

function normalizeLevel(level: any): IntroductionStateLevel {
  if (typeof level !== 'string') return '';
  const lower = level.trim().toLowerCase().replace(/[\.!?,;:]+$/g, '');
  const mapping: Record<string, IntroductionStateLevel> = {
    beginner: 'beginner',
    intermediate: 'intermediate',
    advanced: 'advanced',
    principiante: 'beginner',
    intermedio: 'intermediate',
    avanzado: 'advanced',
  };
  return mapping[lower] || '';
}

class IntroductionStateParserNode extends CustomNode {
  process(_context: ProcessContext, input: any) {
    try {
      const content = (input && (input as any).content) || input;
      const textContent = typeof content === 'string' ? content : JSON.stringify(content);
      console.log('IntroductionStateParserNode - Raw LLM response:', textContent);
      
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

export function createIntroductionStateGraph() {
  const apiKey = process.env.INWORLD_API_KEY;
  if (!apiKey) {
    throw new Error('INWORLD_API_KEY environment variable is required');
  }

  const promptBuilderNode = new IntroductionPromptBuilderNode({ id: 'introduction-prompt-builder' });
  const textToChatRequestNode = new TextToChatRequestNode({ id: 'text-to-chat-request' });
  const llmNode = new RemoteLLMChatNode({
    id: 'llm_node',
    provider: 'openai',
    modelName: 'gpt-4.1',
    stream: false,
  });
  const parserNode = new IntroductionStateParserNode({ id: 'introduction-state-parser' });

  const executor = new GraphBuilder('introduction-state-graph')
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


