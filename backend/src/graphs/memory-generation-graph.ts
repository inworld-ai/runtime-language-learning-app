/**
 * Memory Generation Graph
 *
 * A simple graph that generates memories from conversation history.
 * Used by the MemoryProcessor to create memory records in the background.
 *
 * Graph Flow:
 * Input → MemoryPromptBuilder → LLM → Output
 */

import {
  Graph,
  GraphBuilder,
  ProxyNode,
  RemoteLLMChatNode,
} from '@inworld/runtime/graph';

import { MemoryPromptBuilderNode } from './nodes/memory-prompt-builder-node.js';
import { llmConfig } from '../config/llm.js';
import { graphLogger as logger } from '../utils/logger.js';

export interface MemoryGenerationGraphConfig {
  graphId?: string;
}

/**
 * Create a memory generation graph
 */
export function createMemoryGenerationGraph(
  config: MemoryGenerationGraphConfig = {}
): Graph {
  const { graphId = 'memory-generation-graph' } = config;

  logger.info({ graphId }, 'creating_memory_generation_graph');

  // Input proxy node
  const inputNode = new ProxyNode({ id: `${graphId}-input` });

  // Memory prompt builder
  const memoryPromptBuilderNode = new MemoryPromptBuilderNode({
    id: `${graphId}-prompt-builder`,
  });

  // LLM node for memory generation
  const llmNode = new RemoteLLMChatNode({
    id: `${graphId}-llm`,
    provider: llmConfig.memoryGeneration.provider,
    modelName: llmConfig.memoryGeneration.model,
    stream: false,
    textGenerationConfig: llmConfig.memoryGeneration.textGenerationConfig,
    reportToClient: false,
  });

  // Build the graph
  const graphBuilder = new GraphBuilder({
    id: graphId,
    enableRemoteConfig: false,
  });

  graphBuilder
    .addNode(inputNode)
    .addNode(memoryPromptBuilderNode)
    .addNode(llmNode)
    .addEdge(inputNode, memoryPromptBuilderNode)
    .addEdge(memoryPromptBuilderNode, llmNode)
    .setStartNode(inputNode)
    .setEndNode(llmNode);

  const graph = graphBuilder.build();

  logger.info({ graphId }, 'memory_generation_graph_created');

  return graph;
}
