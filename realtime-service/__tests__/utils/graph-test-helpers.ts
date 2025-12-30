/**
 * Helper utilities for testing graph-related components
 */

import { GraphBuilder } from '@inworld/runtime/graph';

/**
 * Creates a mock GraphBuilder for testing
 */
export function createMockGraphBuilder(graphId: string = 'test-graph') {
  const nodes: any[] = [];
  const edges: any[] = [];

  const builder = {
    addNode: jest.fn((node: any) => {
      nodes.push(node);
      return builder;
    }),
    addEdge: jest.fn((from: any, to: any, options?: any) => {
      edges.push({ from, to, options });
      return builder;
    }),
    setStartNode: jest.fn((node: any) => {
      return builder;
    }),
    setEndNode: jest.fn((node: any) => {
      return builder;
    }),
    build: jest.fn(() => ({
      id: graphId,
      nodes,
      edges,
      start: jest.fn(),
      stop: jest.fn(),
      execute: jest.fn(),
    })),
  };

  return builder;
}

/**
 * Creates a mock Graph instance
 */
export function createMockGraph(graphId: string = 'test-graph') {
  return {
    id: graphId,
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    execute: jest.fn().mockResolvedValue(undefined),
    getNodeById: jest.fn(),
    getAllNodes: jest.fn(() => []),
  };
}

/**
 * Helper to wait for async operations in tests
 */
export async function waitForAsync(ms: number = 0): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Helper to create a mock async iterator for streaming data
 */
export async function* createMockAsyncIterator<T>(items: T[]): AsyncIterableIterator<T> {
  for (const item of items) {
    yield item;
  }
}

