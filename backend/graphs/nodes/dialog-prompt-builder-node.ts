/**
 * DialogPromptBuilderNode builds a LLM chat request from the state.
 *
 * This node is specifically designed for the language learning app and:
 * - Receives the current conversation state
 * - Applies the language-specific prompt template
 * - Uses Jinja to render the prompt with conversation history
 * - Returns a formatted LLMChatRequest for the LLM node
 */

import { CustomNode, GraphTypes, ProcessContext } from '@inworld/runtime/graph';
import { PromptBuilder } from '@inworld/runtime/primitives/llm';
import { ConnectionsMap, State } from '../../types/index.js';
import { getLanguageConfig } from '../../config/languages.js';
import { conversationTemplate } from '../../helpers/prompt-templates.js';

export class DialogPromptBuilderNode extends CustomNode {
  constructor(props: {
    id: string;
    connections: ConnectionsMap;
    reportToClient?: boolean;
  }) {
    super({
      id: props.id,
      reportToClient: props.reportToClient,
    });
    // connections passed for future use (e.g., accessing global state)
  }

  async process(
    _context: ProcessContext,
    state: State
  ): Promise<GraphTypes.LLMChatRequest> {
    console.log(
      `[DialogPromptBuilder] Building prompt for ${state.languageCode || 'es'}, ${state.messages?.length || 0} messages`
    );

    // Get language config from state
    const langConfig = getLanguageConfig(state.languageCode || 'es');

    // Build template variables from language config
    const templateVars = {
      target_language: langConfig.name,
      target_language_native: langConfig.nativeName,
      teacher_name: langConfig.teacherPersona.name,
      teacher_description: langConfig.teacherPersona.description,
      example_topics: langConfig.exampleTopics.join(', '),
      language_instructions: langConfig.promptInstructions,
    };

    // Get all messages except the last user message (that's our current_input)
    const messages = state.messages || [];
    const historyMessages = messages.slice(0, -1); // All except last
    const lastMessage = messages[messages.length - 1];
    const currentInput = lastMessage?.role === 'user' ? lastMessage.content : '';

    console.log('[DialogPromptBuilder] Language:', langConfig.name);
    console.log('[DialogPromptBuilder] Messages in history:', historyMessages.length);

    const templateData = {
      messages: historyMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      current_input: currentInput,
      ...templateVars,
    };

    // Render the prompt using PromptBuilder (Jinja2)
    const builder = await PromptBuilder.create(conversationTemplate);
    const renderedPrompt = await builder.build(templateData);

    // Debug: Log a snippet of the rendered prompt
    const promptSnippet = renderedPrompt.substring(0, 400);
    console.log(
      `[DialogPromptBuilder] Rendered prompt (first 400 chars): ${promptSnippet}...`
    );

    // Return LLMChatRequest for the LLM node
    return new GraphTypes.LLMChatRequest({
      messages: [{ role: 'user', content: renderedPrompt }],
    });
  }
}

