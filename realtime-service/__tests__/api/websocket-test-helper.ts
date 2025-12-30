/**
 * WebSocket API Test Helper
 * Provides utilities for testing the WebSocket Realtime API
 */

import WebSocket from 'ws';
import * as RT from '../../src/types/realtime';

export interface WebSocketTestClient {
  ws: WebSocket;
  events: RT.ServerEvent[];
  waitForEvent: (eventType: string, timeout?: number) => Promise<RT.ServerEvent>;
  waitForEvents: (eventTypes: string[], timeout?: number) => Promise<RT.ServerEvent[]>;
  sendEvent: (event: RT.ClientEvent) => void;
  clearEvents: () => void;
  close: () => Promise<void>;
}

/**
 * Create a WebSocket test client that connects to the realtime service
 */
export async function createWebSocketTestClient(
  sessionKey: string,
  port: number = 3001,
  workspaceId?: string
): Promise<WebSocketTestClient> {
  const options: any = {};
  if (workspaceId) {
    options.headers = {
      'workspace-id': workspaceId,
    };
  }

  const ws = new WebSocket(`ws://localhost:${port}/session?key=${sessionKey}`, options);

  const events: RT.ServerEvent[] = [];
  const eventPromises = new Map<string, Array<(event: RT.ServerEvent) => void>>();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(
        `WebSocket connection timeout. ` +
        `Make sure the server is running: cd src && npm start`
      ));
    }, 5000);

    ws.on('open', () => {
      clearTimeout(timeout);

      const client: WebSocketTestClient = {
        ws,
        events,

        waitForEvent: (eventType: string, timeout = 5000): Promise<RT.ServerEvent> => {
          // Check if event already received
          const existingEvent = events.find(e => e.type === eventType);
          if (existingEvent) {
            return Promise.resolve(existingEvent);
          }

          // Wait for new event
          return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
              reject(new Error(`Timeout waiting for event: ${eventType}`));
            }, timeout);

            if (!eventPromises.has(eventType)) {
              eventPromises.set(eventType, []);
            }

            eventPromises.get(eventType)!.push((event) => {
              clearTimeout(timeoutId);
              resolve(event);
            });
          });
        },

        waitForEvents: async (eventTypes: string[], timeout = 5000): Promise<RT.ServerEvent[]> => {
          const results: RT.ServerEvent[] = [];
          const startTime = Date.now();

          for (const eventType of eventTypes) {
            const remainingTime = timeout - (Date.now() - startTime);
            if (remainingTime <= 0) {
              throw new Error(`Timeout waiting for events: ${eventTypes.join(', ')}`);
            }

            const event = await client.waitForEvent(eventType, remainingTime);
            results.push(event);
          }

          return results;
        },

        sendEvent: (event: RT.ClientEvent): void => {
          ws.send(JSON.stringify(event));
        },

        clearEvents: (): void => {
          events.length = 0;
        },

        close: (): Promise<void> => {
          return new Promise((resolve) => {
            ws.once('close', () => resolve());
            ws.close();
          });
        },
      };

      resolve(client);
    });

    ws.on('message', (data: any) => {
      try {
        const event = JSON.parse(data.toString()) as RT.ServerEvent;
        events.push(event);

        // Resolve any waiting promises for this event type
        const waiters = eventPromises.get(event.type);
        if (waiters && waiters.length > 0) {
          const waiter = waiters.shift()!;
          waiter(event);
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    });

    ws.on('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(
        `WebSocket connection failed: ${error.message}\n` +
        `\n` +
        `Make sure the server is running on port ${port}:\n` +
        `  1. Open a new terminal\n` +
        `  2. cd <path-to-project>/serving/realtime-service/src\n` +
        `  3. npm start\n` +
        `  4. Wait for "Application Server listening on port ${port}"\n` +
        `  5. Then run: npm run test:api`
      ));
    });
  });
}

/**
 * Helper to collect all events until a specific event type is received
 */
export async function collectEventsUntil(
  client: WebSocketTestClient,
  untilEventType: string,
  timeout: number = 5000
): Promise<RT.ServerEvent[]> {
  const startLength = client.events.length;
  await client.waitForEvent(untilEventType, timeout);
  return client.events.slice(startLength);
}

/**
 * Assert that an event matches expected properties
 */
export function assertEvent(
  event: RT.ServerEvent,
  expectedType: string,
  additionalChecks?: (event: any) => void
): void {
  expect(event.type).toBe(expectedType);
  expect(event.event_id).toBeDefined();
  
  if (additionalChecks) {
    additionalChecks(event);
  }
}

/**
 * Create a text message conversation item
 */
export function createTextMessage(
  text: string,
  role: 'user' | 'assistant' | 'system' = 'user',
  id?: string
): RT.MessageItem {
  return {
    type: 'message',
    role,
    content: [
      {
        type: 'input_text',
        text,
      },
    ],
    ...(id && { id }),
  };
}

/**
 * Create a function call output item
 */
export function createFunctionCallOutput(
  callId: string,
  output: string,
  id?: string
): RT.FunctionCallOutputItem {
  return {
    type: 'function_call_output',
    call_id: callId,
    output,
    ...(id && { id }),
  };
}

/**
 * Wait for a complete response (from response.created to response.done)
 */
export async function waitForCompleteResponse(
  client: WebSocketTestClient,
  timeout: number = 30000
): Promise<{
  created: RT.ResponseCreatedEvent;
  done: RT.ResponseDoneEvent;
  allEvents: RT.ServerEvent[];
}> {
  const startLength = client.events.length;
  
  const created = await client.waitForEvent('response.created', timeout);
  const done = await client.waitForEvent('response.done', timeout);
  
  const allEvents = client.events.slice(startLength);
  
  return {
    created: created as RT.ResponseCreatedEvent,
    done: done as RT.ResponseDoneEvent,
    allEvents,
  };
}

/**
 * Extract text content from a response
 */
export function extractTextFromResponse(events: RT.ServerEvent[]): string {
  let text = '';
  
  for (const event of events) {
    if (event.type === 'response.output_text.delta') {
      const deltaEvent = event as RT.ResponseTextDeltaEvent;
      text += deltaEvent.delta;
    }
  }
  
  return text;
}

/**
 * Extract audio transcript from a response
 */
export function extractAudioTranscriptFromResponse(events: RT.ServerEvent[]): string {
  let transcript = '';
  
  for (const event of events) {
    if (event.type === 'response.output_audio_transcript.delta') {
      const deltaEvent = event as RT.ResponseAudioTranscriptDeltaEvent;
      transcript += deltaEvent.delta;
    }
  }
  
  return transcript;
}

/**
 * Verify that a new conversation request works after cancellation
 */
export async function verifyContinuationAfterCancellation(
  client: WebSocketTestClient,
  originalResponseId: string,
  newMessageText: string,
): Promise<void> {
  // Clear events to ensure we wait for NEW response events
  client.clearEvents();

  // Verify we can send a new conversation request after cancellation
  client.sendEvent({
    type: 'conversation.item.create',
    item: createTextMessage(newMessageText, 'user'),
  });

  await client.waitForEvent('conversation.item.done');

  client.sendEvent({
    type: 'response.create',
  });

  const newResponse = await waitForCompleteResponse(client, 30000);

  assertEvent(newResponse.created, 'response.created', (event: RT.ResponseCreatedEvent) => {
    expect(event.response.id).toBeDefined();
    expect(event.response.id).not.toBe(originalResponseId);
    expect(event.response.status).toBe('in_progress');
  });

  assertEvent(newResponse.done, 'response.done', (event: RT.ResponseDoneEvent) => {
    expect(['completed', 'incomplete']).toContain(event.response.status);
  });

  // Verify we got some output in the new response
  const hasOutput = newResponse.allEvents.some(
    e => e.type === 'response.output_text.delta' || e.type === 'response.output_audio.delta'
  );
  expect(hasOutput).toBe(true);
}

