# Realtime Service Tests

Comprehensive API-level integration tests for the OpenAI Realtime API WebSocket service.

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Server (Terminal 1)
```bash
cd src && npm start
```
Wait for: `Application Server listening on port 4000`

### 3. Run Tests (Terminal 2)
```bash
npm test
```

That's it! ✅

> **TL;DR:** See [`SIMPLE_START.md`](./SIMPLE_START.md) for the absolute quickest guide.

---

## Table of Contents

- [What We Test](#what-we-test)
- [Running Tests](#running-tests)
- [Writing Tests](#writing-tests)
- [Test Utilities](#test-utilities)
- [Troubleshooting](#troubleshooting)
- [Why API Tests Only](#why-api-tests-only)
- [CI/CD Integration](#cicd-integration)

---

## What We Test

We use **API-level integration tests** that validate complete WebSocket behavior:

✅ **Session Management** (3 tests) - Creation, configuration, turn detection  
✅ **Conversation Management** (5 tests) - CRUD operations on items  
✅ **Response Generation** (4 tests) - Complete response lifecycle  
✅ **Function Calling** (1 test) - Tool execution  
✅ **Audio Input** (1 test) - Buffer operations  
✅ **Error Handling** (2 tests) - Invalid requests  
✅ **Multi-Session** (1 test) - Concurrent sessions  
✅ **Workspace Isolation** (1 test) - Multi-tenancy  

**Total: 18 passing tests, 1 skipped** (~6 seconds runtime)

---

## Running Tests

### Basic Commands

```bash
# Run all tests (requires server running)
npm test

# Run in watch mode
npm run test:watch

# Run with coverage report
npm run test:coverage

# Run specific test
npm test -- -t "should create a session"
```

### Environment Variables

Optionally create `.env.test` in the project root:

```bash
INWORLD_API_KEY=your-api-key
WORKSPACE_ID=your-workspace-id
```

**Note:** `WS_APP_PORT` is automatically managed by tests - they find an available port dynamically.

---

## Writing Tests

### Test Structure

```typescript
import { v4 as uuidv4 } from 'uuid';
import { createWebSocketTestClient, createTextMessage } from './websocket-test-helper';

it('should test some API behavior', async () => {
  // 1. Create client with unique session ID
  const sessionKey = `test-session-${uuidv4()}`;
  const client = await createWebSocketTestClient(sessionKey, 4000);
  
  try {
    // 2. Wait for session initialization
    await client.waitForEvent('session.created');
    
    // 3. Send client event
    client.sendEvent({
      type: 'conversation.item.create',
      item: createTextMessage('Hello, world!'),
    });
    
    // 4. Verify server response
    const addedEvent = await client.waitForEvent('conversation.item.added');
    expect(addedEvent.item.content[0].text).toBe('Hello, world!');
    
  } finally {
    // 5. Always clean up
    await client.close();
  }
});
```

### Best Practices

✅ **Use unique session IDs** - `uuidv4()` for each test  
✅ **Always close connections** - Use try/finally blocks  
✅ **Set appropriate timeouts** - Default is 5000ms, adjust if needed  
✅ **Test both success and errors** - Don't just test happy paths  
✅ **Keep tests independent** - No shared state between tests  

---

## Test Utilities

### Creating a Test Client

```typescript
const client = await createWebSocketTestClient(
  'session-123',  // session key
  4000,           // port (optional, defaults to 3001)
  'workspace-id'  // workspace ID (optional)
);
```

### Waiting for Events

```typescript
// Wait for single event
const event = await client.waitForEvent('session.created', 5000);

// Wait for multiple events in sequence
const [event1, event2] = await client.waitForEvents([
  'conversation.item.added',
  'conversation.item.done'
], 10000);

// Wait for complete response cycle
const response = await waitForCompleteResponse(client);
const text = extractTextFromResponse(response.allEvents);
```

### Sending Events

```typescript
// Send any client event
client.sendEvent({
  type: 'conversation.item.create',
  item: createTextMessage('Hello'),
});

// Create different message types
const userMsg = createTextMessage('Hello', 'user', 'msg-123');
const functionOutput = createFunctionCallOutput('call-123', '{"result": true}');
```

### Assertions

```typescript
// Assert event properties
assertEvent(event, 'session.created', (evt) => {
  expect(evt.session.id).toBeDefined();
  expect(evt.session.model).toBe('expected-model');
});
```

### All Helper Functions

- `createWebSocketTestClient()` - Create test client
- `waitForEvent()` - Wait for specific event
- `waitForEvents()` - Wait for multiple events
- `waitForCompleteResponse()` - Wait for full response
- `assertEvent()` - Assert event properties
- `createTextMessage()` - Create text message item
- `createFunctionCallOutput()` - Create function output
- `extractTextFromResponse()` - Extract text from events
- `extractAudioTranscriptFromResponse()` - Extract audio transcript

See [`api/README.md`](./api/README.md) for detailed API documentation.

---

## Troubleshooting

### Connection Refused

**Problem:** Tests fail with `ECONNREFUSED`  
**Solution:** Start the server first:
```bash
cd src && npm start
```
Wait for "Application Server listening on port 4000", then run tests.

### Tests Timeout

**Problem:** Tests timeout waiting for events  
**Solutions:**
- Check server logs for errors
- Verify environment variables are set
- Increase timeout: `await client.waitForEvent('event', 30000)`
- Make sure server is running on correct port (4000)

### Port Already in Use

**Problem:** Can't start server - port 4000 in use  
**Solution:**
```bash
# Kill process on port 4000
lsof -ti:4000 | xargs kill

# Or use different port
WS_APP_PORT=4001 npm start  # Terminal 1
WS_APP_PORT=4001 npm test   # Terminal 2
```

### Module Not Found

**Problem:** `Cannot find module 'uuid'`  
**Solution:** Run `npm install`

### Debugging Tests

```typescript
// View all received events
it('debug test', async () => {
  const client = await createWebSocketTestClient('test');
  await client.waitForEvent('session.created');
  
  console.log('Events:', JSON.stringify(client.events, null, 2));
});

// Increase timeout for debugging
jest.setTimeout(300000); // 5 minutes
```

---

## Why API Tests Only?

We chose **API integration tests** over traditional unit tests.

### What We DON'T Do ❌

```typescript
// Unit testing internal nodes (we avoid this)
it('node should process input', () => {
  const node = new TextInputNode(config);
  const result = node.process(context, input);
  expect(result.messages).toContainEqual(...);
});
```
**Problem:** Tests implementation details, breaks on refactoring

### What We DO ✅

```typescript
// Testing API behavior (our approach)
it('should create conversation item', async () => {
  const client = await createWebSocketTestClient('session-123');
  await client.waitForEvent('session.created');
  
  client.sendEvent({
    type: 'conversation.item.create',
    item: createTextMessage('Hello'),
  });
  
  const event = await client.waitForEvent('conversation.item.added');
  expect(event.item.content[0].text).toBe('Hello');
});
```
**Benefit:** Tests actual behavior, survives refactoring

### Benefits

1. **Tests Real Behavior** - Validates what users actually experience
2. **OpenAI Compliance** - Ensures API contract adherence
3. **Refactor-Safe** - Tests survive internal code changes
4. **Living Documentation** - Tests show how to use the API
5. **Higher Confidence** - Tests complete integration paths
6. **Fewer Tests** - 18 comprehensive tests vs 100+ unit tests

### Trade-offs

We accept these trade-offs for better overall testing:

- ⚠️ Requires running server (~1 command in separate terminal)
- ⚠️ Slower execution (~6 seconds vs milliseconds for unit tests)
- ⚠️ May need environment configuration for API keys
- ⚠️ Debugging spans multiple components

**Result:** Better testing with less maintenance burden. Simple setup, comprehensive coverage!

---

## CI/CD Integration

### GitHub Actions Example

```yaml
name: API Tests

on: [push, pull_request]

jobs:
  api-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm install
        
      - name: Start server
        run: cd src && npm start &
        
      - name: Wait for server
        run: sleep 5
        
      - name: Run tests
        run: npm test
        
      - name: Upload coverage
        uses: codecov/codecov-action@v2
        if: always()
```

---

## Project Structure

```
__tests__/
├── api/
│   ├── realtime-api.spec.ts      # 18 test cases
│   ├── websocket-test-helper.ts  # Test utilities
│   ├── websocket-server-helper.ts
│   └── README.md                 # Detailed API docs
│
├── utils/                        # Legacy (kept for reference)
│   ├── mock-helpers.ts
│   └── graph-test-helpers.ts
│
├── config.ts                     # Test constants
├── setup.ts                      # Jest setup
├── test-setup.ts                 # Test environment
└── README.md                     # This file
```

---

## Test Statistics

- **Test Files:** 1 (`realtime-api.spec.ts`)
- **Test Cases:** 18 passing, 1 skipped
- **Test Duration:** ~6 seconds
- **Test Categories:** 8
- **Lines of Code:** ~1,100 test code

### Latest Results

```
PASS __tests__/api/realtime-api.spec.ts (6.704 s)
  ✓ Session Management (3/3)
  ✓ Conversation Management (5/5)
  ✓ Response Generation (4/4)
  ✓ Function Calling (1/1)
  ✓ Audio Input Management (1/2, 1 skipped)
  ✓ Error Handling (2/2)
  ✓ Multi-Session Support (1/1)
  ✓ Workspace Isolation (1/1)

Tests: 18 passed, 1 skipped, 19 total
Time: 6.826 s
```

---

## Configuration

### Jest (`jest.config.js`)

- Timeout: 30 seconds
- Environment: Node.js
- Uses: ts-jest with `tsconfig.test.json`

### TypeScript (`tsconfig.test.json`)

- Extends: `src/tsconfig.json`
- Includes: `__tests__/**/*.ts`
- CommonJS modules for Jest compatibility

### Environment (`.env.test`)

```bash
WS_APP_PORT=4000
INWORLD_API_KEY=your-key
WORKSPACE_ID=your-workspace
```

---

## Contributing

When adding new features:

1. **Add API tests** for the new behavior
2. **Test success and error cases**
3. **Use existing tests as templates**
4. **Update this README** if patterns change
5. **Ensure all tests pass** before committing

### Example: Adding a New Test

```typescript
describe('New Feature', () => {
  let client: WebSocketTestClient;
  const sessionKey = `test-session-${uuidv4()}`;

  beforeEach(async () => {
    client = await createWebSocketTestClient(sessionKey);
    await client.waitForEvent('session.created');
  });

  afterEach(async () => {
    if (client) await client.close();
  });

  it('should handle new feature', async () => {
    // Test implementation
  });
});
```

---

## Support

- **Detailed API docs:** [`api/README.md`](./api/README.md)
- **Jest documentation:** https://jestjs.io/
- **WebSocket API spec:** Check `src/REALTIME_API.md`

---

**Last Updated:** November 2024  
**Status:** ✅ All tests passing  
**Test Coverage:** Run `npm run test:coverage` to check
