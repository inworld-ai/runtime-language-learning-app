# API Test Utilities Reference

Helper functions and utilities for writing API integration tests.

> **Main Documentation:** See [`../__tests__/README.md`](../README.md) for complete testing guide.

---

## WebSocket Test Client

### Creating a Client

```typescript
import { createWebSocketTestClient } from './websocket-test-helper';

const client = await createWebSocketTestClient(
  sessionKey,      // string: unique session identifier
  port?,           // number: server port (default: 3001)
  workspaceId?     // string: optional workspace ID
);
```

### Client Interface

```typescript
interface WebSocketTestClient {
  ws: WebSocket;                    // Raw WebSocket instance
  events: RT.ServerEvent[];         // All received events
  
  // Wait for specific event
  waitForEvent(eventType: string, timeout?: number): Promise<RT.ServerEvent>;
  
  // Wait for multiple events in sequence
  waitForEvents(eventTypes: string[], timeout?: number): Promise<RT.ServerEvent[]>;
  
  // Send client event
  sendEvent(event: RT.ClientEvent): void;
  
  // Close connection
  close(): Promise<void>;
}
```

---

## Event Utilities

### Wait for Event

```typescript
// Wait for single event (default 5s timeout)
const event = await client.waitForEvent('session.created');

// With custom timeout
const event = await client.waitForEvent('response.done', 30000);
```

### Wait for Multiple Events

```typescript
const [event1, event2] = await client.waitForEvents([
  'conversation.item.added',
  'conversation.item.done'
], 10000);
```

### Wait for Complete Response

```typescript
import { waitForCompleteResponse } from './websocket-test-helper';

const response = await waitForCompleteResponse(client, 30000);
// Returns: { created, done, allEvents }
```

### Collect Events Until

```typescript
import { collectEventsUntil } from './websocket-test-helper';

const events = await collectEventsUntil(client, 'response.done', 10000);
```

---

## Message Creation

### Create Text Message

```typescript
import { createTextMessage } from './websocket-test-helper';

// Basic
const msg = createTextMessage('Hello, world!');

// With role
const userMsg = createTextMessage('Hello', 'user');
const sysMsg = createTextMessage('Instructions', 'system');

// With ID
const msg = createTextMessage('Hello', 'user', 'msg-123');
```

Returns:
```typescript
{
  type: 'message',
  role: 'user' | 'assistant' | 'system',
  content: [{ type: 'input_text', text: string }],
  id?: string
}
```

### Create Function Call Output

```typescript
import { createFunctionCallOutput } from './websocket-test-helper';

const output = createFunctionCallOutput(
  'call-123',                    // call_id
  '{"temperature": 72}',         // output (JSON string)
  'output-456'                   // optional id
);
```

Returns:
```typescript
{
  type: 'function_call_output',
  call_id: string,
  output: string,
  id?: string
}
```

---

## Assertions

### Assert Event Properties

```typescript
import { assertEvent } from './websocket-test-helper';

// Basic assertion
assertEvent(event, 'session.created');

// With additional checks
assertEvent(event, 'session.created', (evt) => {
  expect(evt.session.id).toBeDefined();
  expect(evt.session.model).toBe('expected-model');
  expect(evt.session.audio.output.voice).toBe('Dennis');
});
```

---

## Response Utilities

### Extract Text from Response

```typescript
import { extractTextFromResponse } from './websocket-test-helper';

const response = await waitForCompleteResponse(client);
const text = extractTextFromResponse(response.allEvents);

console.log('Response text:', text);
```

### Extract Audio Transcript

```typescript
import { extractAudioTranscriptFromResponse } from './websocket-test-helper';

const response = await waitForCompleteResponse(client);
const transcript = extractAudioTranscriptFromResponse(response.allEvents);

console.log('Audio transcript:', transcript);
```

---

## Complete Example

```typescript
import { v4 as uuidv4 } from 'uuid';
import {
  createWebSocketTestClient,
  createTextMessage,
  waitForCompleteResponse,
  extractTextFromResponse,
  assertEvent,
} from './websocket-test-helper';

it('should handle conversation flow', async () => {
  // Create client
  const sessionKey = `test-${uuidv4()}`;
  const client = await createWebSocketTestClient(sessionKey, 4000);
  
  try {
    // Wait for session
    const sessionEvent = await client.waitForEvent('session.created');
    assertEvent(sessionEvent, 'session.created', (evt) => {
      expect(evt.session.id).toBeDefined();
    });
    
    // Create conversation item
    client.sendEvent({
      type: 'conversation.item.create',
      item: createTextMessage('Hello, how are you?', 'user'),
    });
    
    // Verify item was added
    const [added, done] = await client.waitForEvents([
      'conversation.item.added',
      'conversation.item.done'
    ]);
    
    assertEvent(added, 'conversation.item.added');
    assertEvent(done, 'conversation.item.done');
    
    // Generate response
    client.sendEvent({ type: 'response.create' });
    
    // Wait for complete response
    const response = await waitForCompleteResponse(client, 30000);
    const text = extractTextFromResponse(response.allEvents);
    
    expect(text.length).toBeGreaterThan(0);
    
  } finally {
    await client.close();
  }
});
```

---

## Server Management (Optional)

For automated server lifecycle management:

```typescript
import {
  startTestServer,
  stopTestServer,
  waitForServerReady,
  getServerPort,
} from './websocket-server-helper';

// Start server
const port = await startTestServer(4000);
await waitForServerReady(port);

// Run tests...

// Stop server
await stopTestServer();
```

---

## Type Definitions

All types are imported from `../../src/types/realtime`:

```typescript
import * as RT from '../../src/types/realtime';

// Client events
RT.ClientEvent
RT.SessionUpdateEvent
RT.ConversationItemCreateEvent
RT.ResponseCreateEvent
// ... etc

// Server events
RT.ServerEvent
RT.SessionCreatedEvent
RT.ConversationItemAddedEvent
RT.ResponseCreatedEvent
// ... etc

// Data types
RT.MessageItem
RT.FunctionCallItem
RT.FunctionCallOutputItem
RT.Session
RT.Response
```

---

## Helper Function Summary

| Function | Purpose |
|----------|---------|
| `createWebSocketTestClient()` | Create and connect test client |
| `waitForEvent()` | Wait for specific event |
| `waitForEvents()` | Wait for multiple events |
| `waitForCompleteResponse()` | Wait for full response cycle |
| `collectEventsUntil()` | Collect all events until target |
| `assertEvent()` | Assert event type and properties |
| `createTextMessage()` | Create text message item |
| `createFunctionCallOutput()` | Create function output item |
| `extractTextFromResponse()` | Extract text from response events |
| `extractAudioTranscriptFromResponse()` | Extract audio transcript |

---

For complete testing documentation, examples, and troubleshooting, see the [main README](../README.md).
