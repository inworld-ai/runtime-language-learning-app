/**
 * Jest setupFilesAfterEnv configuration
 * This runs after the test framework is installed
 */

// Mock the logger to prevent console output during tests
jest.mock('../src/logger', () => ({
  default: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    trace: jest.fn(),
    fatal: jest.fn(),
  },
}));

// Mock log-helpers
jest.mock('../src/log-helpers', () => ({
  formatContext: jest.fn((context: any) => JSON.stringify(context)),
  formatSession: jest.fn((session: any) => JSON.stringify(session)),
  formatWorkspace: jest.fn((workspace: any) => JSON.stringify(workspace)),
}));

// Set up common test behaviors
beforeEach(() => {
  jest.clearAllMocks();
});

// Global test timeout
jest.setTimeout(30000);

