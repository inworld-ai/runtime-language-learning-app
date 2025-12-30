/**
 * Helper utilities for creating readable log messages with key context
 * 
 * These helpers make it easy to include important information in both:
 * 1. The message text (visible at a glance)
 * 2. Structured fields (for querying/filtering)
 */

/**
 * Format a session context tag for log messages
 * Usage: `Something happened ${formatSession(sessionId)}`
 */
export function formatSession(sessionId: string | undefined): string {
  return sessionId ? `[session:${sessionId}]` : '';
}

/**
 * Format a workspace context tag for log messages
 * Usage: `Something happened ${formatWorkspace(workspaceId)}`
 */
export function formatWorkspace(workspaceId: string | undefined): string {
  return workspaceId ? `[workspace:${workspaceId}]` : '';
}

/**
 * Format an interaction context tag for log messages
 * Usage: `Something happened ${formatInteraction(interactionId)}`
 */
export function formatInteraction(interactionId: string | undefined): string {
  return interactionId ? `[interaction:${interactionId}]` : '';
}

/**
 * Format a duration in milliseconds
 * Usage: `Completed ${formatDuration(elapsed)}`
 */
export function formatDuration(ms: number | undefined): string {
  return ms !== undefined ? `[duration:${ms}ms]` : '';
}

/**
 * Format an error message
 * Usage: `Failed ${formatError(error)}`
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `: ${error.message}`;
  }
  return error ? `: ${String(error)}` : '';
}

/**
 * Combine session and workspace tags
 * Usage: `Something happened ${formatContext(sessionId, workspaceId)}`
 */
export function formatContext(
  sessionId?: string,
  workspaceId?: string,
  interactionId?: string
): string {
  const parts = [
    formatSession(sessionId),
    formatWorkspace(workspaceId),
    formatInteraction(interactionId),
  ].filter(Boolean);
  
  return parts.join(' ');
}

/**
 * Example usage:
 * 
 * logger.info(
 *   { sessionId, workspaceId },
 *   `WebSocket connected ${formatContext(sessionId, workspaceId)}`
 * );
 * 
 * logger.error(
 *   { error, sessionId, operation },
 *   `Operation failed ${formatSession(sessionId)}${formatError(error)}`
 * );
 * 
 * logger.info(
 *   { sessionId, duration },
 *   `Request completed ${formatSession(sessionId)} ${formatDuration(duration)}`
 * );
 */

