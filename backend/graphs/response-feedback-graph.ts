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
import { llmConfig } from '../config/llm.js';
import { feedbackLogger as logger } from '../utils/logger.js';

export interface ResponseFeedbackInput {
  messages: Array<{ role: string; content: string }>;
  currentTranscript: string;
  targetLanguage: string;
}

const responseFeedbackPromptTemplate = `
You are a {{targetLanguage}} language tutor assistant. Your task is to analyze the student's most recent utterance and provide brief, helpful feedback.

## Conversation so far:
{% for message in messages %}
{{ message.role }}: {{ message.content }}
{% endfor %}

## Student's last utterance:
{{ currentTranscript }}

## Instructions:
- If the student made any grammar, vocabulary, or pronunciation errors in their {{targetLanguage}}, offer a gentle correction
- If the student's response was good, offer a brief word of encouragement or a small tip to improve
- Keep your feedback to exactly ONE sentence in English
- Be encouraging and constructive

Your feedback (one sentence in English):`.trim();

class FeedbackPromptBuilderNode extends CustomNode {
  async process(_context: ProcessContext, input: ResponseFeedbackInput) {
    const builder = await PromptBuilder.create(responseFeedbackPromptTemplate);
    const renderedPrompt = await builder.build(
      input as unknown as Record<string, unknown>
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

class FeedbackExtractorNode extends CustomNode {
  process(_context: ProcessContext, input: GraphTypes.Content) {
    const content =
      (input &&
        typeof input === 'object' &&
        'content' in input &&
        (input as { content?: unknown }).content) ||
      input;
    const textContent =
      typeof content === 'string' ? content : JSON.stringify(content);

    // Return just the feedback string, trimmed
    return textContent.trim();
  }
}

/**
 * Creates a response feedback graph that analyzes user utterances
 * and provides one-sentence feedback in English
 */
function createResponseFeedbackGraph(): Graph {
  const apiKey = process.env.INWORLD_API_KEY;
  if (!apiKey) {
    throw new Error('INWORLD_API_KEY environment variable is required');
  }

  const promptBuilderNode = new FeedbackPromptBuilderNode({
    id: 'feedback-prompt-builder',
  });
  const textToChatRequestNode = new TextToChatRequestNode({
    id: 'text-to-chat-request',
  });
  const llmNode = new RemoteLLMChatNode({
    id: 'llm-node',
    provider: llmConfig.feedback.provider,
    modelName: llmConfig.feedback.model,
    stream: llmConfig.feedback.stream,
    textGenerationConfig: llmConfig.feedback.textGenerationConfig,
  });
  const extractorNode = new FeedbackExtractorNode({ id: 'feedback-extractor' });

  const executor = new GraphBuilder({
    id: 'response-feedback-graph',
    enableRemoteConfig: false,
  })
    .addNode(promptBuilderNode)
    .addNode(textToChatRequestNode)
    .addNode(llmNode)
    .addNode(extractorNode)
    .addEdge(promptBuilderNode, textToChatRequestNode)
    .addEdge(textToChatRequestNode, llmNode)
    .addEdge(llmNode, extractorNode)
    .setStartNode(promptBuilderNode)
    .setEndNode(extractorNode)
    .build();

  return executor;
}

// Cache for the single response feedback graph instance
let responseFeedbackGraph: Graph | null = null;

/**
 * Get or create the response feedback graph
 */
export function getResponseFeedbackGraph(): Graph {
  if (!responseFeedbackGraph) {
    logger.info('creating_response_feedback_graph');
    responseFeedbackGraph = createResponseFeedbackGraph();
  }
  return responseFeedbackGraph;
}
