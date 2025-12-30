/**
 * Mock helpers for unit tests
 * These utilities help create mock objects for testing
 */

import { ProcessContext } from '@inworld/runtime/graph';
import { ConnectionsMap, State, Connection } from '../../types/index';

/**
 * Creates a mock ProcessContext for testing
 */
export function createMockProcessContext(datastoreData: Record<string, any> = {}): ProcessContext {
  const datastore = new Map(Object.entries(datastoreData));
  
  return {
    getDatastore: jest.fn(() => ({
      get: jest.fn((key: string) => datastore.get(key)),
      set: jest.fn((key: string, value: any) => datastore.set(key, value)),
      has: jest.fn((key: string) => datastore.has(key)),
      delete: jest.fn((key: string) => datastore.delete(key)),
    })),
    getNodeId: jest.fn(() => 'test-node-id'),
    getGraphId: jest.fn(() => 'test-graph-id'),
  } as any;
}

/**
 * Creates a mock State object for testing
 */
export function createMockState(overrides: Partial<State> = {}): State {
  return {
    sessionId: overrides.sessionId || 'test-session-id',
    interactionId: overrides.interactionId || 'test-interaction-id',
    messages: overrides.messages || [],
    eagerness: overrides.eagerness || 'medium',
    ...overrides,
  } as State;
}

/**
 * Creates a mock Connection object for testing
 */
export function createMockConnection(
  sessionId: string = 'test-session-id',
  stateOverrides: Partial<State> = {}
): Connection {
  return {
    sessionId,
    state: createMockState({ sessionId, ...stateOverrides }),
    unloaded: false,
  } as Connection;
}

/**
 * Creates a mock ConnectionsMap for testing
 */
export function createMockConnectionsMap(
  sessions: string[] = ['test-session-id']
): ConnectionsMap {
  const connections: ConnectionsMap = {};
  
  sessions.forEach(sessionId => {
    connections[sessionId] = createMockConnection(sessionId);
  });
  
  return connections;
}

/**
 * Creates a mock DataStreamWithMetadata for testing
 */
export function createMockDataStreamWithMetadata(metadata: Record<string, any> = {}) {
  return {
    getMetadata: jest.fn(() => metadata),
    getData: jest.fn(() => Buffer.from('test-data')),
    setMetadata: jest.fn(),
  };
}

/**
 * Helper to create a spy on a logger
 */
export function createLoggerSpy() {
  return {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    trace: jest.fn(),
    fatal: jest.fn(),
  };
}

