import 'dotenv/config';
import { 
  GraphBuilder, 
  CustomNode, 
  ProcessContext, 
  RemoteLLMChatNode 
} from '@inworld/runtime/graph';
import { GraphTypes } from '@inworld/runtime/common';
import { renderJinja } from '@inworld/runtime/primitives/llm';
import { flashcardPromptTemplate } from '../helpers/prompt-templates.ts';
import { v4 } from 'uuid';
import { Flashcard } from '../helpers/flashcard-processor.ts';

class FlashcardPromptBuilderNode extends CustomNode {
  async process(_context: ProcessContext, input: any) {
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
  process(_context: ProcessContext, input: any) {
    try {
      const content = (input && (input as any).content) || input;
      const textContent =
        typeof content === 'string' ? content : JSON.stringify(content);

      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          id: v4(),
          spanish: parsed.spanish ?? '',
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
      spanish: '',
      english: '',
      example: '',
      mnemonic: '',
      timestamp: new Date().toISOString(),
      error: 'Failed to generate flashcard',
    } as Flashcard;
  }
}

export function createFlashcardGraph() {
  const apiKey = process.env.INWORLD_API_KEY;
  if (!apiKey) {
    throw new Error('INWORLD_API_KEY environment variable is required');
  }

  const promptBuilderNode = new FlashcardPromptBuilderNode({ id: 'flashcard-prompt-builder' });
  const textToChatRequestNode = new TextToChatRequestNode({ id: 'text-to-chat-request' });
  const llmNode = new RemoteLLMChatNode({
    id: 'llm_node',
    provider: 'openai',
    modelName: 'gpt-4.1',
    stream: false,
    textGenerationConfig: {
      maxNewTokens: 2500,
      maxPromptLength: 100,
      repetitionPenalty: 1,
      topP: 1,
      temperature: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
    }
  });
  const parserNode = new FlashcardParserNode({ id: 'flashcard-parser' });

  const executor = new GraphBuilder('flashcard-generation-graph')
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