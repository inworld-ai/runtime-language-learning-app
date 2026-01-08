/**
 * MemoryPromptBuilderNode builds the prompt for memory generation.
 *
 * Takes conversation messages and target language, renders the memory
 * generation template, and outputs an LLMChatRequest.
 */

import { CustomNode, ProcessContext } from '@inworld/runtime/graph';
import { GraphTypes } from '@inworld/runtime/common';
import { PromptBuilder } from '@inworld/runtime/primitives/llm';
import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const promptsDir = join(__dirname, '..', '..', 'prompts');

// Cache for the template
let memoryGenerationTemplate: string | null = null;

async function loadMemoryTemplate(): Promise<string> {
  if (!memoryGenerationTemplate) {
    memoryGenerationTemplate = await readFile(
      join(promptsDir, 'memory-generation.njk'),
      'utf-8'
    );
  }
  return memoryGenerationTemplate;
}

export interface MemoryPromptInput {
  messages: Array<{ role: string; content: string }>;
  target_language: string;
}

export class MemoryPromptBuilderNode extends CustomNode {
  constructor(props: { id: string }) {
    super({ id: props.id });
  }

  async process(
    _context: ProcessContext,
    input: MemoryPromptInput
  ): Promise<GraphTypes.LLMChatRequest> {
    const template = await loadMemoryTemplate();
    const builder = await PromptBuilder.create(template);
    const renderedPrompt = await builder.build({
      messages: input.messages,
      target_language: input.target_language,
    });
    return new GraphTypes.LLMChatRequest({
      messages: [{ role: 'user', content: renderedPrompt }],
    });
  }
}
