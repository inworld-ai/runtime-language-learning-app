import {
  GraphBuilder,
  CustomNode,
  ProcessContext,
  ProxyNode,
  RemoteLLMChatNode,
  RemoteSTTNode,
  RemoteTTSNode,
  TextChunkingNode,
  Graph,
} from '@inworld/runtime/graph';
import { GraphTypes } from '@inworld/runtime/common';
import { renderJinja } from '@inworld/runtime/primitives/llm';
import { AsyncLocalStorage } from 'async_hooks';
import { conversationTemplate } from '../helpers/prompt-templates.js';
import type { IntroductionState } from '../helpers/introduction-state-processor.js';
import {
  LanguageConfig,
  getLanguageConfig,
  DEFAULT_LANGUAGE_CODE,
} from '../config/languages.js';

export interface ConversationGraphConfig {
  apiKey: string;
}

// Use AsyncLocalStorage to store state accessors directly per async execution context
// This eliminates the need for a registry and connectionId lookup
export const stateStorage = new AsyncLocalStorage<{
  getConversationState: () => {
    messages: Array<{ role: string; content: string; timestamp: string }>;
  };
  getIntroductionState: () => IntroductionState;
  getLanguageConfig: () => LanguageConfig;
}>();

// Store the current execution context as module-level variables
// This is set by AudioProcessor before starting graph execution
// and read by the PromptBuilder during execution.
// This works because Node.js is single-threaded for synchronous execution.
let currentExecutionLanguageCode: string = DEFAULT_LANGUAGE_CODE;
let currentGetConversationState: (() => { messages: Array<{ role: string; content: string; timestamp: string }> }) | null = null;
let currentGetIntroductionState: (() => IntroductionState) | null = null;

/**
 * Set the execution context for the current graph execution.
 * Must be called before starting graph execution.
 */
export function setCurrentExecutionContext(context: {
  languageCode: string;
  getConversationState: () => { messages: Array<{ role: string; content: string; timestamp: string }> };
  getIntroductionState: () => IntroductionState;
}): void {
  currentExecutionLanguageCode = context.languageCode;
  currentGetConversationState = context.getConversationState;
  currentGetIntroductionState = context.getIntroductionState;
  console.log(`[ConversationGraph] Set execution context for language: ${context.languageCode}`);
}

/**
 * Set the language code for the current graph execution.
 * @deprecated Use setCurrentExecutionContext instead
 */
export function setCurrentExecutionLanguage(languageCode: string): void {
  currentExecutionLanguageCode = languageCode;
  console.log(`[ConversationGraph] Set execution language to: ${languageCode}`);
}

/**
 * EnhancedPromptBuilderNode - defined once at module level to avoid
 * component registry collisions. State and language config are retrieved from
 * module-level variables (set by AudioProcessor before graph execution).
 */
class EnhancedPromptBuilderNode extends CustomNode {
  async process(_context: ProcessContext, currentInput: string) {
    // Get language config using the current execution language code
    const langConfig = getLanguageConfig(currentExecutionLanguageCode);
    const nodeId = (this as unknown as { id: string }).id;

    console.log(
      `[PromptBuilder] Node ${nodeId} using execution language: ${langConfig.name} (code: ${currentExecutionLanguageCode})`
    );

    // Build template variables from language config
    const templateVars = {
      target_language: langConfig.name,
      target_language_native: langConfig.nativeName,
      teacher_name: langConfig.teacherPersona.name,
      teacher_description: langConfig.teacherPersona.description,
      example_topics: langConfig.exampleTopics.join(', '),
      language_instructions: langConfig.promptInstructions,
    };

    // Get state from module-level accessors (set by AudioProcessor before execution)
    // These bypass AsyncLocalStorage which gets broken by Inworld runtime
    const conversationState = currentGetConversationState
      ? currentGetConversationState()
      : { messages: [] };
    const introductionState = currentGetIntroductionState
      ? currentGetIntroductionState()
      : { name: '', level: '', goal: '', timestamp: '' };

    console.log(
      '[PromptBuilder] Introduction state:',
      JSON.stringify(introductionState, null, 2)
    );
    console.log('[PromptBuilder] Language:', langConfig.name);
    console.log(
      '[PromptBuilder] Messages in history:',
      conversationState.messages?.length || 0
    );

    const templateData = {
      messages: conversationState.messages || [],
      current_input: currentInput,
      introduction_state: introductionState,
      ...templateVars,
    };

    const renderedPrompt = await renderJinja(
      conversationTemplate,
      JSON.stringify(templateData)
    );

    // Debug: Log a snippet of the rendered prompt to verify content
    const promptSnippet = renderedPrompt.substring(0, 400);
    console.log(
      `[PromptBuilder] Rendered prompt (first 400 chars): ${promptSnippet}...`
    );

    // Return LLMChatRequest for the LLM node
    return new GraphTypes.LLMChatRequest({
      messages: [{ role: 'user', content: renderedPrompt }],
    });
  }
}

/**
 * Creates a conversation graph configured for a specific language
 */
function createConversationGraphForLanguage(
  _config: ConversationGraphConfig,
  languageConfig: LanguageConfig
): Graph {

  // Use language code as suffix to make node IDs unique per language
  // This prevents edge condition name collisions in the global callback registry
  const langSuffix = `_${languageConfig.code}`;
  const promptBuilderNodeId = `enhanced_prompt_builder_node${langSuffix}`;

  console.log(
    `[ConversationGraph] Creating graph with prompt builder node: ${promptBuilderNodeId}`
  );

  // Configure STT for the specific language
  const sttNode = new RemoteSTTNode({
    id: `stt_node${langSuffix}`,
    sttConfig: {
      languageCode: languageConfig.sttLanguageCode,
    },
  });

  const sttOutputNode = new ProxyNode({
    id: `proxy_node${langSuffix}`,
    reportToClient: true,
  });

  const promptBuilderNode = new EnhancedPromptBuilderNode({
    id: promptBuilderNodeId,
  });

  const llmNode = new RemoteLLMChatNode({
    id: `llm_node${langSuffix}`,
    provider: 'openai',
    modelName: 'gpt-4o-mini',
    stream: true,
    reportToClient: true,
    textGenerationConfig: {
      maxNewTokens: 250,
      maxPromptLength: 2000,
      repetitionPenalty: 1,
      topP: 1,
      temperature: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
    },
  });

  const chunkerNode = new TextChunkingNode({ id: `chunker_node${langSuffix}` });

  // Configure TTS for the specific language
  const ttsNode = new RemoteTTSNode({
    id: `tts_node${langSuffix}`,
    speakerId: languageConfig.ttsConfig.speakerId,
    modelId: languageConfig.ttsConfig.modelId,
    sampleRate: 16000,
    speakingRate: languageConfig.ttsConfig.speakingRate,
    temperature: languageConfig.ttsConfig.temperature,
    languageCode: languageConfig.ttsConfig.languageCode,
  });

  const executor = new GraphBuilder({
    id: `conversation_graph_${languageConfig.code}`,
    enableRemoteConfig: false,
  })
    .addNode(sttNode)
    .addNode(sttOutputNode)
    .addNode(promptBuilderNode)
    .addNode(llmNode)
    .addNode(chunkerNode)
    .addNode(ttsNode)
    .setStartNode(sttNode)
    .addEdge(sttNode, sttOutputNode)
    .addEdge(sttNode, promptBuilderNode, {
      condition: async (input: string) => {
        return input.trim().length > 0;
      },
    })
    .addEdge(promptBuilderNode, llmNode)
    .addEdge(llmNode, chunkerNode)
    .addEdge(chunkerNode, ttsNode)
    .setEndNode(sttOutputNode)
    .setEndNode(ttsNode)
    .build();

  return executor;
}

// Cache for language-specific graphs
const graphCache = new Map<string, Graph>();

/**
 * Get or create a conversation graph for a specific language
 * Graphs are cached to avoid recreation overhead
 */
export function getConversationGraph(
  config: ConversationGraphConfig,
  languageCode: string = DEFAULT_LANGUAGE_CODE
): Graph {
  const cacheKey = languageCode;

  if (!graphCache.has(cacheKey)) {
    const languageConfig = getLanguageConfig(languageCode);
    console.log(
      `Creating conversation graph for language: ${languageConfig.name} (${languageCode})`
    );
    const graph = createConversationGraphForLanguage(config, languageConfig);
    graphCache.set(cacheKey, graph);
  }

  return graphCache.get(cacheKey)!;
}

/**
 * Legacy function for backwards compatibility
 * Creates or returns the default (Spanish) graph
 */
export function createConversationGraph(config: ConversationGraphConfig): Graph {
  return getConversationGraph(config, DEFAULT_LANGUAGE_CODE);
}

/**
 * Clear the graph cache (useful for testing or reconfiguration)
 */
export function clearGraphCache(): void {
  graphCache.clear();
}
