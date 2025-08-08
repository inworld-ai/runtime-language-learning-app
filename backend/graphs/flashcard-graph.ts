import 'dotenv/config';
import {
  GraphBuilder,
  NodeFactory,
  ComponentFactory,
  registerCustomNodeType,
  CustomInputDataType,
  CustomOutputDataType,
  ProcessContext,
} from '@inworld/runtime/graph';
import { renderJinja } from '@inworld/runtime/primitives/llm';
import { flashcardPromptTemplate } from '../helpers/prompt-templates.ts';
import { v4 } from 'uuid';

const flashcardPromptBuilderNodeType = registerCustomNodeType(
  'FlashcardPromptBuilder',
  [CustomInputDataType.CUSTOM],
  CustomOutputDataType.TEXT,
  async (_context: ProcessContext, input: any) => {
    const renderedPrompt = await renderJinja(
      flashcardPromptTemplate,
      JSON.stringify(input)
    );
    return renderedPrompt;
  }
);

// Custom node to convert text prompt to chat request format
const textToChatRequestNodeType = registerCustomNodeType(
  'TextToChatRequest',
  [CustomInputDataType.TEXT],
  CustomOutputDataType.CHAT_REQUEST,
  (_context: ProcessContext, renderedPrompt: string) => {
    return {
      messages: [
        { role: 'user', content: renderedPrompt }
      ]
    };
  }
);

// Custom node to parse LLM response and extract JSON
const flashcardParserNodeType = registerCustomNodeType(
  'FlashcardParser',
  [CustomInputDataType.CONTENT],
  CustomOutputDataType.CUSTOM,
  (_context: ProcessContext, input: any) => {
    try {
      // Extract the content from the LLM response
      const content = input.content || input;
      const textContent = typeof content === 'string' ? content : JSON.stringify(content);
      
      // Try to extract JSON from the response
      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          id: v4(),
          spanish: parsed.spanish || '',
          english: parsed.english || '',
          example: parsed.example || '',
          mnemonic: parsed.mnemonic || '',
          timestamp: new Date().toISOString()
        };
      }
    } catch (error) {
      console.error('Failed to parse flashcard JSON:', error);
    }
    
    // Return default structure if parsing fails
    return {
      id: v4(),
      spanish: '',
      english: '',
      example: '',
      mnemonic: '',
      timestamp: new Date().toISOString(),
      error: 'Failed to generate flashcard'
    };
  }
);

export function createFlashcardGraph() {
  const apiKey = process.env.INWORLD_API_KEY;
  
  if (!apiKey) {
    throw new Error('INWORLD_API_KEY environment variable is required');
  }

  // Create nodes
  const promptBuilderNode = NodeFactory.createCustomNode(
    'flashcard-prompt-builder',
    flashcardPromptBuilderNodeType
  );

  const textToChatRequestNode = NodeFactory.createCustomNode(
    'text-to-chat-request',
    textToChatRequestNodeType
  );

  const llmNode = NodeFactory.createRemoteLLMChatNode({
    id: 'llm_node',
    llmConfig: {
      provider: 'openai',
      modelName: 'gpt-4.1',
      apiKey: apiKey,
      stream: false,
    },
  });

  const parserNode = NodeFactory.createCustomNode(
    'flashcard-parser',
    flashcardParserNodeType
  );

  // Build the graph
  const graph = new GraphBuilder('flashcard-generation-graph')
    .addNode(promptBuilderNode)
    .addNode(textToChatRequestNode)
    .addNode(llmNode)
    .addNode(parserNode)
    .addEdge(promptBuilderNode, textToChatRequestNode)
    .addEdge(textToChatRequestNode, llmNode)
    .addEdge(llmNode, parserNode)
    .setStartNode(promptBuilderNode)
    .setEndNode(parserNode);

  return graph;
}