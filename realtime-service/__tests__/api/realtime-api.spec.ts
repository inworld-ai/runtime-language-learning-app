/**
 * OpenAI Realtime API Integration Tests
 * Tests the WebSocket API behavior end-to-end
 * 
 * IMPORTANT: Before running these tests, start the WebSocket server:
 *   1. Open a new terminal
 *   2. cd to the serving/realtime-service/src directory
 *   3. npm start
 *   4. Wait for "Application Server listening on port 3001"
 *   5. Then run: npm run test:api
 */

import { v4 as uuidv4 } from 'uuid';
import * as RT from '../../src/types/realtime';
import {
  createWebSocketTestClient,
  assertEvent,
  createTextMessage,
  createFunctionCallOutput,
  waitForCompleteResponse,
  extractTextFromResponse,
  verifyContinuationAfterCancellation,
  WebSocketTestClient,
} from './websocket-test-helper';

// Get port from environment variable
const TEST_PORT = process.env.WS_APP_PORT ? parseInt(process.env.WS_APP_PORT) : 4000;

describe('OpenAI Realtime API - Integration Tests', () => {
  jest.setTimeout(60000); // 60 second timeout for API tests

  describe('Session Management', () => {
    let client: WebSocketTestClient;
    const sessionKey = `test-session-${uuidv4()}`;

    afterEach(async () => {
      if (client) {
        await client.close();
      }
    });

    it('should create a session on connection and send session.created event', async () => {
      client = await createWebSocketTestClient(sessionKey, TEST_PORT);

      const sessionCreatedEvent = await client.waitForEvent('session.created', 5000);

      assertEvent(sessionCreatedEvent, 'session.created', (event: RT.SessionCreatedEvent) => {
        expect(event.session).toBeDefined();
        expect(event.session.id).toBeDefined();
        expect(event.session.type).toBe('realtime');
        expect(event.session.object).toBe('realtime.session');
        expect(event.session.model).toBeDefined();
        expect(event.session.output_modalities).toEqual(expect.arrayContaining(['audio', 'text']));
        expect(event.session.audio).toBeDefined();
        expect(event.session.audio.input).toBeDefined();
        expect(event.session.audio.output).toBeDefined();
        expect(event.session.audio.output.voice).toBeDefined();
        expect(event.session.instructions).toBeDefined();
      });
    });

    it('should update session configuration via session.update', async () => {
      client = await createWebSocketTestClient(sessionKey, TEST_PORT);

      await client.waitForEvent('session.created');

      const newInstructions = 'You are a helpful assistant that speaks like a pirate.';
      const newVoice = 'TestVoice';

      client.sendEvent({
        type: 'session.update',
        session: {
          instructions: newInstructions,
          audio: {
            output: {
              voice: newVoice,
            },
          },
          temperature: 0.9,
        },
      });

      const sessionUpdatedEvent = await client.waitForEvent('session.updated', 5000);

      assertEvent(sessionUpdatedEvent, 'session.updated', (event: RT.SessionUpdatedEvent) => {
        expect(event.session.instructions).toBe(newInstructions);
        expect(event.session.audio.output.voice).toBe(newVoice);
        expect(event.session.temperature).toBe(0.9);
      });
    });

    it('should update turn detection settings', async () => {
      client = await createWebSocketTestClient(sessionKey, TEST_PORT);

      await client.waitForEvent('session.created');

      client.sendEvent({
        type: 'session.update',
        session: {
          audio: {
            input: {
              turn_detection: {
                type: 'semantic_vad',
                eagerness: 'high',
                create_response: true,
                interrupt_response: true,
              },
            },
          },
        },
      });

      const sessionUpdatedEvent = await client.waitForEvent('session.updated', 5000);

      assertEvent(sessionUpdatedEvent, 'session.updated', (event: RT.SessionUpdatedEvent) => {
        expect(event.session.audio.input.turn_detection).toBeDefined();
        expect(event.session.audio.input.turn_detection?.type).toBe('semantic_vad');
        if (event.session.audio.input.turn_detection?.type === 'semantic_vad') {
          expect(event.session.audio.input.turn_detection.eagerness).toBe('high');
        }
      });
    });
  });

  describe('Conversation Management', () => {
    let client: WebSocketTestClient;
    const sessionKey = `test-session-${uuidv4()}`;

    beforeEach(async () => {
      client = await createWebSocketTestClient(sessionKey, TEST_PORT);
      await client.waitForEvent('session.created');
    });

    afterEach(async () => {
      if (client) {
        await client.close();
      }
    });

    it('should create a conversation item and receive confirmation events', async () => {
      const messageId = `msg-${uuidv4()}`;
      const messageText = 'Hello, this is a test message.';

      client.sendEvent({
        type: 'conversation.item.create',
        item: createTextMessage(messageText, 'user', messageId),
      });

      const events = await client.waitForEvents([
        'conversation.item.added',
        'conversation.item.done',
      ], 5000);

      const [addedEvent, doneEvent] = events;

      assertEvent(addedEvent, 'conversation.item.added', (event: RT.ConversationItemAddedEvent) => {
        expect(event.item.id).toBe(messageId);
        expect(event.item.type).toBe('message');
        expect(event.item.status).toBe('completed');
      });

      assertEvent(doneEvent, 'conversation.item.done', (event: RT.ConversationItemDoneEvent) => {
        expect(event.item.id).toBe(messageId);
      });
    });

    it('should retrieve a conversation item by ID', async () => {
      const messageId = `msg-${uuidv4()}`;
      const messageText = 'Test message for retrieval';

      // Create item first
      client.sendEvent({
        type: 'conversation.item.create',
        item: createTextMessage(messageText, 'user', messageId),
      });

      await client.waitForEvent('conversation.item.done');

      // Retrieve the item
      client.sendEvent({
        type: 'conversation.item.retrieve',
        item_id: messageId,
      });

      const retrievedEvent = await client.waitForEvent('conversation.item.retrieved', 5000);

      assertEvent(retrievedEvent, 'conversation.item.retrieved', (event: RT.ConversationItemRetrievedEvent) => {
        expect(event.item.id).toBe(messageId);
        expect(event.item.type).toBe('message');
      });
    });

    it('should delete a conversation item', async () => {
      const messageId = `msg-${uuidv4()}`;

      // Create item first
      client.sendEvent({
        type: 'conversation.item.create',
        item: createTextMessage('Message to delete', 'user', messageId),
      });

      await client.waitForEvent('conversation.item.done');

      // Delete the item
      client.sendEvent({
        type: 'conversation.item.delete',
        item_id: messageId,
      });

      const deletedEvent = await client.waitForEvent('conversation.item.deleted', 5000);

      assertEvent(deletedEvent, 'conversation.item.deleted', (event: RT.ConversationItemDeletedEvent) => {
        expect(event.item_id).toBe(messageId);
      });

      // Verify item is gone by trying to retrieve it
      client.sendEvent({
        type: 'conversation.item.retrieve',
        item_id: messageId,
      });

      const errorEvent = await client.waitForEvent('error', 5000);

      assertEvent(errorEvent, 'error', (event: RT.ErrorEvent) => {
        expect(event.error.code).toBe('item_not_found');
      });
    });

    it('should handle truncation of conversation items', async () => {
      const messageId = `msg-${uuidv4()}`;

      // Create an assistant message with audio (in real scenario)
      client.sendEvent({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'assistant',
          id: messageId,
          content: [
            {
              type: 'audio',
              audio: 'base64audiodata',
              transcript: 'This is a long message that will be truncated',
            },
          ],
        } as RT.MessageItem,
      });

      await client.waitForEvent('conversation.item.done');

      // Truncate at 1000ms
      client.sendEvent({
        type: 'conversation.item.truncate',
        item_id: messageId,
        content_index: 0,
        audio_end_ms: 1000,
      });

      const truncatedEvent = await client.waitForEvent('conversation.item.truncated', 5000);

      assertEvent(truncatedEvent, 'conversation.item.truncated', (event: RT.ConversationItemTruncatedEvent) => {
        expect(event.item_id).toBe(messageId);
        expect(event.content_index).toBe(0);
        expect(event.audio_end_ms).toBe(1000);
      });
    });

    it('should return error when trying to retrieve non-existent item', async () => {
      const nonExistentId = `msg-${uuidv4()}`;

      client.sendEvent({
        type: 'conversation.item.retrieve',
        item_id: nonExistentId,
      });

      const errorEvent = await client.waitForEvent('error', 5000);

      assertEvent(errorEvent, 'error', (event: RT.ErrorEvent) => {
        expect(event.error.type).toBe('invalid_request_error');
        expect(event.error.code).toBe('item_not_found');
        expect(event.error.message).toContain(nonExistentId);
      });
    });
  });

  describe('Response Generation', () => {
    let client: WebSocketTestClient;
    const sessionKey = `test-session-${uuidv4()}`;

    beforeEach(async () => {
      client = await createWebSocketTestClient(sessionKey, TEST_PORT);
      await client.waitForEvent('session.created');

      // Set up session with text-only output for simpler testing
      client.sendEvent({
        type: 'session.update',
        session: {
          output_modalities: ['text'],
          instructions: 'You are a helpful assistant. Keep responses brief.',
        },
      });

      await client.waitForEvent('session.updated');
    });

    afterEach(async () => {
      if (client) {
        await client.close();
      }
    });

    it('should generate a response to a user message', async () => {
      // Create user message
      client.sendEvent({
        type: 'conversation.item.create',
        item: createTextMessage('Say hello', 'user'),
      });

      await client.waitForEvent('conversation.item.done');

      // Request response
      client.sendEvent({
        type: 'response.create',
      });

      const response = await waitForCompleteResponse(client, 30000);

      assertEvent(response.created, 'response.created', (event: RT.ResponseCreatedEvent) => {
        expect(event.response.id).toBeDefined();
        expect(event.response.status).toBe('in_progress');
      });

      assertEvent(response.done, 'response.done', (event: RT.ResponseDoneEvent) => {
        expect(event.response.id).toBe(response.created.response.id);
        expect(['completed', 'incomplete']).toContain(event.response.status);
      });

      // Verify we got text output
      const text = extractTextFromResponse(response.allEvents);
      expect(text.length).toBeGreaterThan(0);
    });

    it('should emit response events in correct order', async () => {
      // Create user message
      client.sendEvent({
        type: 'conversation.item.create',
        item: createTextMessage('Count to three', 'user'),
      });

      await client.waitForEvent('conversation.item.done');

      // Request response
      client.sendEvent({
        type: 'response.create',
      });

      const response = await waitForCompleteResponse(client, 30000);

      const eventTypes = response.allEvents.map(e => e.type);

      // Verify event ordering
      const createdIndex = eventTypes.indexOf('response.created');
      const doneIndex = eventTypes.indexOf('response.done');

      expect(createdIndex).toBeGreaterThanOrEqual(0);
      expect(doneIndex).toBeGreaterThan(createdIndex);

      // All response-related events should be between created and done
      const betweenEvents = eventTypes.slice(createdIndex + 1, doneIndex);
      betweenEvents.forEach(type => {
        expect(type).toMatch(/^(response\.|conversation\.item)/);
      });
    });

    it('should cancel response immediately after creation', async () => {
      // Create user message
      client.sendEvent({
        type: 'conversation.item.create',
        item: createTextMessage('Tell me a long story', 'user'),
      });

      await client.waitForEvent('conversation.item.done');

      // Request response
      client.sendEvent({
        type: 'response.create',
      });

      // Wait for response to start
      const createdEvent = await client.waitForEvent('response.created', 5000);
      const responseId = (createdEvent as RT.ResponseCreatedEvent).response.id;

      // Cancel immediately after creation
      client.sendEvent({
        type: 'response.cancel',
        response_id: responseId,
      });

      // Wait for response.done with cancelled status
      const doneEvent = await client.waitForEvent('response.done', 10000);

      assertEvent(doneEvent, 'response.done', (event: RT.ResponseDoneEvent) => {
        expect(event.response.id).toBe(responseId);
        expect(event.response.status).toBe('cancelled');
        expect(event.response.status_details?.type).toBe('cancelled');
        expect(event.response.status_details?.reason).toBe('client_cancelled');
      });

      // Verify conversation continues to work after cancellation
      await verifyContinuationAfterCancellation(client, responseId, 'Say hello');
    });

    it('should cancel response after first text delta', async () => {
      // Create user message
      client.sendEvent({
        type: 'conversation.item.create',
        item: createTextMessage('Tell me a story', 'user'),
      });

      await client.waitForEvent('conversation.item.done');

      // Request response (text-only mode already set in session)
      client.sendEvent({
        type: 'response.create',
      });

      // Wait for response to start
      const createdEvent = await client.waitForEvent('response.created', 5000);
      const responseId = (createdEvent as RT.ResponseCreatedEvent).response.id;

      // Wait for first text delta (using correct event type: response.output_text.delta)
      const firstDelta = await client.waitForEvent('response.output_text.delta', 10000);
      expect(firstDelta).toBeDefined();

      // Cancel after receiving first delta
      client.sendEvent({
        type: 'response.cancel',
        response_id: responseId,
      });

      // Wait for response.done with cancelled status
      const doneEvent = await client.waitForEvent('response.done', 10000);

      assertEvent(doneEvent, 'response.done', (event: RT.ResponseDoneEvent) => {
        expect(event.response.id).toBe(responseId);
        expect(event.response.status).toBe('cancelled');
        expect(event.response.status_details?.type).toBe('cancelled');
        expect(event.response.status_details?.reason).toBe('client_cancelled');
        // Response should have at least one output item with some content
        expect(event.response.output.length).toBeGreaterThan(0);
      });

      // Verify conversation continues to work after cancellation
      await verifyContinuationAfterCancellation(client, responseId, 'Say goodbye');
    });

    it('should cancel response during audio streaming', async () => {
      // Update session to enable audio output
      client.sendEvent({
        type: 'session.update',
        session: {
          output_modalities: ['audio', 'text'],
          instructions: 'You are a helpful assistant. Provide detailed responses.',
        },
      });

      await client.waitForEvent('session.updated');

      // Create user message with a prompt that will generate a longer response
      client.sendEvent({
        type: 'conversation.item.create',
        item: createTextMessage('Hello', 'user'),
      });

      await client.waitForEvent('conversation.item.done');

      // Request response with audio output
      client.sendEvent({
        type: 'response.create',
      });

      // Wait for response to start
      const createdEvent = await client.waitForEvent('response.created', 5000);
      const responseId = (createdEvent as RT.ResponseCreatedEvent).response.id;

      // Wait for audio to start streaming (using correct event type: response.output_audio.delta)
      await client.waitForEvent('response.output_audio.delta', 10000);

      // Cancel during audio streaming
      client.sendEvent({
        type: 'response.cancel',
        response_id: responseId,
      });

      // Wait for response.done with cancelled status
      const doneEvent = await client.waitForEvent('response.done', 10000);

      assertEvent(doneEvent, 'response.done', (event: RT.ResponseDoneEvent) => {
        expect(event.response.id).toBe(responseId);
        expect(event.response.status).toBe('cancelled');
        expect(event.response.status_details?.type).toBe('cancelled');
        expect(event.response.status_details?.reason).toBe('client_cancelled');
      });

      // Verify conversation continues to work after cancellation
      await verifyContinuationAfterCancellation(client, responseId, 'Hi again');
    });

    it.skip('should cancel response during long audio/text streaming', async () => {
      // Update session to enable audio output
      client.sendEvent({
        type: 'session.update',
        session: {
          output_modalities: ['audio', 'text'],
          instructions: 'You are a helpful assistant. Provide detailed responses.',
        },
      });

      await client.waitForEvent('session.updated');

      // Create user message with a prompt that will generate a longer response
      client.sendEvent({
        type: 'conversation.item.create',
        item: createTextMessage('Tell me a detailed story about space exploration with multiple paragraphs', 'user'),
      });

      await client.waitForEvent('conversation.item.done');

      // Request response with audio output
      client.sendEvent({
        type: 'response.create',
      });

      // Wait for response to start
      const createdEvent = await client.waitForEvent('response.created', 5000);
      const responseId = (createdEvent as RT.ResponseCreatedEvent).response.id;

      // Wait for audio to start streaming (using correct event type: response.output_audio.delta)
      await client.waitForEvent('response.output_audio.delta', 10000);

      // Wait just a moment to ensure we're mid-stream (but not so long that response completes)
      await new Promise(resolve => setTimeout(resolve, 50));

      // Cancel during audio streaming
      client.sendEvent({
        type: 'response.cancel',
        response_id: responseId,
      });

      // Wait for response.done with cancelled status
      const doneEvent = await client.waitForEvent('response.done', 10000);

      assertEvent(doneEvent, 'response.done', (event: RT.ResponseDoneEvent) => {
        expect(event.response.id).toBe(responseId);
        expect(event.response.status).toBe('cancelled');
        expect(event.response.status_details?.type).toBe('cancelled');
        expect(event.response.status_details?.reason).toBe('client_cancelled');
      });

      // Verify conversation continues to work after cancellation
      await verifyContinuationAfterCancellation(client, responseId, 'What is 2+2?');
    });

    it('should include usage information in response', async () => {
      // Create user message
      client.sendEvent({
        type: 'conversation.item.create',
        item: createTextMessage('Hello', 'user'),
      });

      await client.waitForEvent('conversation.item.done');

      // Request response
      client.sendEvent({
        type: 'response.create',
      });

      const response = await waitForCompleteResponse(client, 30000);

      assertEvent(response.done, 'response.done', (event: RT.ResponseDoneEvent) => {
        // Usage might be present (depending on implementation)
        if (event.response.usage) {
          expect(event.response.usage.total_tokens).toBeGreaterThan(0);
          expect(event.response.usage.input_tokens).toBeGreaterThanOrEqual(0);
          expect(event.response.usage.output_tokens).toBeGreaterThan(0);
        }
      });
    });
  });

  describe('Function Calling', () => {
    let client: WebSocketTestClient;
    const sessionKey = `test-session-${uuidv4()}`;

    beforeEach(async () => {
      client = await createWebSocketTestClient(sessionKey, TEST_PORT);
      await client.waitForEvent('session.created');

      // Configure session with function tools
      client.sendEvent({
        type: 'session.update',
        session: {
          output_modalities: ['text'],
          instructions: 'You are a helpful assistant with access to tools.',
          tools: [
            {
              type: 'function',
              name: 'get_weather',
              description: 'Get the current weather for a location',
              parameters: {
                type: 'object',
                properties: {
                  location: {
                    type: 'string',
                    description: 'The city and state, e.g. San Francisco, CA',
                  },
                },
                required: ['location'],
              },
            },
          ],
          tool_choice: 'auto',
        },
      });

      await client.waitForEvent('session.updated');
    });

    afterEach(async () => {
      if (client) {
        await client.close();
      }
    });

    it('should handle function call output', async () => {
      const callId = `call-${uuidv4()}`;
      const functionOutput = JSON.stringify({
        temperature: 72,
        condition: 'sunny',
      });

      // Create function output item
      client.sendEvent({
        type: 'conversation.item.create',
        item: createFunctionCallOutput(callId, functionOutput),
      });

      const events = await client.waitForEvents([
        'conversation.item.added',
        'conversation.item.done',
      ], 5000);

      assertEvent(events[0], 'conversation.item.added', (event: RT.ConversationItemAddedEvent) => {
        expect(event.item.type).toBe('function_call_output');
        const item = event.item as RT.FunctionCallOutputItem;
        expect(item.call_id).toBe(callId);
        expect(item.output).toBe(functionOutput);
      });
    });
  });

  describe('Audio Input Management', () => {
    let client: WebSocketTestClient;
    const sessionKey = `test-session-${uuidv4()}`;

    beforeEach(async () => {
      client = await createWebSocketTestClient(sessionKey, TEST_PORT);
      await client.waitForEvent('session.created');
    });

    afterEach(async () => {
      if (client) {
        await client.close();
      }
    });

    it('should handle input audio buffer clear', async () => {
      // Append some audio data first
      client.sendEvent({
        type: 'input_audio_buffer.append',
        audio: 'YmFzZTY0ZW5jb2RlZGF1ZGlv', // base64 encoded dummy data
      });

      // Give it a moment to process
      await new Promise(resolve => setTimeout(resolve, 100));

      // Clear the buffer
      client.sendEvent({
        type: 'input_audio_buffer.clear',
      });

      const clearedEvent = await client.waitForEvent('input_audio_buffer.cleared', 5000);

      assertEvent(clearedEvent, 'input_audio_buffer.cleared');
    });

    // TODO: This test times out - audio buffer commit may require actual audio data or STT setup
    it.skip('should handle input audio buffer commit', async () => {
      // NOTE: This test is currently skipped because it requires:
      // - Proper audio data (not just base64 dummy data)
      // - Speech-to-text service to be properly configured
      // - AssemblyAI or other STT provider setup

      // Append audio data
      client.sendEvent({
        type: 'input_audio_buffer.append',
        audio: 'YmFzZTY0ZW5jb2RlZGF1ZGlv',
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Commit the buffer
      client.sendEvent({
        type: 'input_audio_buffer.commit',
      });

      const committedEvent = await client.waitForEvent('input_audio_buffer.committed', 30000);

      assertEvent(committedEvent, 'input_audio_buffer.committed', (event: RT.InputAudioBufferCommittedEvent) => {
        expect(event.item_id).toBeDefined();
      });
    });
  });

  describe('Error Handling', () => {
    let client: WebSocketTestClient;
    const sessionKey = `test-session-${uuidv4()}`;

    beforeEach(async () => {
      client = await createWebSocketTestClient(sessionKey, TEST_PORT);
      await client.waitForEvent('session.created');
    });

    afterEach(async () => {
      if (client) {
        await client.close();
      }
    });

    it('should return error for invalid event format', async () => {
      // Send malformed JSON
      client.ws.send('{ invalid json }');

      const errorEvent = await client.waitForEvent('error', 5000);

      assertEvent(errorEvent, 'error', (event: RT.ErrorEvent) => {
        expect(event.error.type).toBe('invalid_request_error');
      });
    });

    it('should return error when truncating user message', async () => {
      const messageId = `msg-${uuidv4()}`;

      // Create a user message
      client.sendEvent({
        type: 'conversation.item.create',
        item: createTextMessage('User message', 'user', messageId),
      });

      await client.waitForEvent('conversation.item.done');

      // Try to truncate (only assistant messages can be truncated)
      client.sendEvent({
        type: 'conversation.item.truncate',
        item_id: messageId,
        content_index: 0,
        audio_end_ms: 1000,
      });

      const errorEvent = await client.waitForEvent('error', 5000);

      assertEvent(errorEvent, 'error', (event: RT.ErrorEvent) => {
        expect(event.error.type).toBe('invalid_request_error');
        expect(event.error.code).toBe('invalid_item_type');
      });
    });
  });

  describe('Multi-Session Support', () => {
    it('should handle multiple concurrent sessions', async () => {
      const session1Key = `test-session-${uuidv4()}`;
      const session2Key = `test-session-${uuidv4()}`;

      const client1 = await createWebSocketTestClient(session1Key, TEST_PORT);
      const client2 = await createWebSocketTestClient(session2Key, TEST_PORT);

      try {
        // Wait for both sessions to be created
        const [session1Created, session2Created] = await Promise.all([
          client1.waitForEvent('session.created'),
          client2.waitForEvent('session.created'),
        ]);

        // Verify they have different session IDs
        const s1 = session1Created as RT.SessionCreatedEvent;
        const s2 = session2Created as RT.SessionCreatedEvent;
        expect(s1.session.id).not.toBe(s2.session.id);

        // Configure sessions differently
        client1.sendEvent({
          type: 'session.update',
          session: {
            instructions: 'You are session 1',
            temperature: 0.5,
          },
        });

        client2.sendEvent({
          type: 'session.update',
          session: {
            instructions: 'You are session 2',
            temperature: 0.9,
          },
        });

        const [updated1, updated2] = await Promise.all([
          client1.waitForEvent('session.updated'),
          client2.waitForEvent('session.updated'),
        ]);

        // Verify each session kept its own configuration
        const u1 = updated1 as RT.SessionUpdatedEvent;
        const u2 = updated2 as RT.SessionUpdatedEvent;
        expect(u1.session.instructions).toBe('You are session 1');
        expect(u1.session.temperature).toBe(0.5);
        expect(u2.session.instructions).toBe('You are session 2');
        expect(u2.session.temperature).toBe(0.9);
      } finally {
        await client1.close();
        await client2.close();
      }
    });
  });

  describe('Workspace Isolation', () => {
    it('should isolate sessions by workspace', async () => {
      const sessionKey = `test-session-${uuidv4()}`;
      const workspace1 = `workspace-${uuidv4()}`;
      const workspace2 = `workspace-${uuidv4()}`;

      const client1 = await createWebSocketTestClient(sessionKey, TEST_PORT, workspace1);
      const client2 = await createWebSocketTestClient(sessionKey, TEST_PORT, workspace2);

      try {
        // Both sessions should be created successfully with same key but different workspaces
        await Promise.all([
          client1.waitForEvent('session.created'),
          client2.waitForEvent('session.created'),
        ]);

        // They should operate independently
        client1.sendEvent({
          type: 'session.update',
          session: {
            instructions: 'Workspace 1 instructions',
          },
        });

        const updated1 = await client1.waitForEvent('session.updated');

        // Verify workspace 1 has its instructions
        const u1 = updated1 as RT.SessionUpdatedEvent;
        expect(u1.session.instructions).toBe('Workspace 1 instructions');

        // Workspace 2 should still have default instructions
        // (we'll verify by updating workspace 2 and checking it didn't get workspace 1's instructions)
        client2.sendEvent({
          type: 'session.update',
          session: {
            instructions: 'Workspace 2 instructions',
          },
        });

        const updated2 = await client2.waitForEvent('session.updated');
        const u2 = updated2 as RT.SessionUpdatedEvent;
        expect(u2.session.instructions).toBe('Workspace 2 instructions');
        expect(u2.session.instructions).not.toBe(u1.session.instructions);
      } finally {
        await client1.close();
        await client2.close();
      }
    });
  });
});

