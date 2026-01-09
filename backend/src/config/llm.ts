/**
 * LLM Configuration
 *
 * Centralized configuration for all LLM providers and models used in the application.
 * To change models or parameters, update this file instead of modifying graph code.
 */

export interface TextGenerationConfig {
  maxNewTokens: number;
  maxPromptLength: number;
  temperature: number;
  topP: number;
  repetitionPenalty: number;
  frequencyPenalty: number;
  presencePenalty: number;
}

export interface LLMNodeConfig {
  provider: string;
  model: string;
  stream: boolean;
  textGenerationConfig: TextGenerationConfig;
}

export const llmConfig = {
  /**
   * Main conversation LLM - used for dialogue responses
   * Streaming enabled for real-time TTS
   */
  conversation: {
    provider: 'openai',
    model: 'gpt-4.1-nano',
    stream: true,
    textGenerationConfig: {
      maxNewTokens: 250,
      maxPromptLength: 2000,
      temperature: 1,
      topP: 1,
      repetitionPenalty: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
    },
  } satisfies LLMNodeConfig,

  /**
   * Flashcard generation LLM - produces vocabulary cards
   * Non-streaming, uses a more capable model for structured output
   */
  flashcard: {
    provider: 'openai',
    model: 'gpt-4.1-nano',
    stream: false,
    textGenerationConfig: {
      maxNewTokens: 2500,
      maxPromptLength: 100,
      temperature: 1,
      topP: 1,
      repetitionPenalty: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
    },
  } satisfies LLMNodeConfig,

  /**
   * Feedback generation LLM - provides learning feedback
   * Non-streaming, lower temperature for consistent feedback
   */
  feedback: {
    provider: 'openai',
    model: 'gpt-4.1-nano',
    stream: false,
    textGenerationConfig: {
      maxNewTokens: 100,
      maxPromptLength: 2000,
      temperature: 0.7,
      topP: 1,
      repetitionPenalty: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
    },
  } satisfies LLMNodeConfig,

  /**
   * Memory generation LLM - creates memories from conversation context
   * Non-streaming, moderate temperature for varied but accurate memories
   */
  memoryGeneration: {
    provider: 'openai',
    model: 'gpt-4.1-nano',
    stream: false,
    textGenerationConfig: {
      maxNewTokens: 200,
      maxPromptLength: 2000,
      temperature: 0.7,
      topP: 1,
      repetitionPenalty: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
    },
  } satisfies LLMNodeConfig,
} as const;
