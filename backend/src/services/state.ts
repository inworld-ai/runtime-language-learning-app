/**
 * Global State Management
 *
 * Centralized state for managing connections, processors, and shutdown status.
 */

import { ConnectionManager } from '../helpers/connection-manager.js';
import { FlashcardProcessor } from '../helpers/flashcard-processor.js';
import { FeedbackProcessor } from '../helpers/feedback-processor.js';
import { MemoryProcessor } from '../helpers/memory-processor.js';
import { ConnectionsMap } from '../types/index.js';

// Shared connections map (used by graph nodes)
export const connections: ConnectionsMap = {};

// Connection managers per WebSocket
export const connectionManagers = new Map<string, ConnectionManager>();
export const flashcardProcessors = new Map<string, FlashcardProcessor>();
export const feedbackProcessors = new Map<string, FeedbackProcessor>();
export const memoryProcessors = new Map<string, MemoryProcessor>();
export const connectionAttributes = new Map<
  string,
  { timezone?: string; userId?: string; languageCode?: string }
>();

// Shutdown flag
let _isShuttingDown = false;

export function isShuttingDown(): boolean {
  return _isShuttingDown;
}

export function setShuttingDown(value: boolean): void {
  _isShuttingDown = value;
}
