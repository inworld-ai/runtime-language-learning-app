# Load Tests

Load testing suite for the Inworld Realtime API service using k6.

## Prerequisites

- [k6](https://k6.io/docs/getting-started/installation/) installed

## Available Test Scripts

### Local Mock Environment
- `npm run test:local:mock:small` - Small load test
- `npm run test:local:mock:medium` - Medium load test
- `npm run test:local:mock:large` - Large load test
- `npm run test:local:mock:xlarge` - Extra large load test

### Local Proxy Environment
- `npm run test:local:proxy:small` - Small load test
- `npm run test:local:proxy:medium` - Medium load test
- `npm run test:local:proxy:large` - Large load test
- `npm run test:local:proxy:xlarge` - Extra large load test

### Local Realtime Service
- `npm run test:local:realtime:small` - Small load test
- `npm run test:local:realtime:medium` - Medium load test
- `npm run test:local:realtime:xmedium` - Extra medium load test
- `npm run test:local:realtime:x2medium` - 2x medium load test
- `npm run test:local:realtime:x2mediumLong` - 2x medium long duration test
- `npm run test:local:realtime:large` - Large load test
- `npm run test:local:realtime:xlarge` - Extra large load test

### Dev Environment
- `npm run test:dev:realtime:small` - Small load test
- `npm run test:dev:realtime:medium` - Medium load test
- `npm run test:dev:realtime:large` - Large load test
- `npm run test:dev:realtime:xlarge` - Extra large load test

## Environment Variables

- `INWORLD_API_KEY` - Base64 encoded API key for authentication (optional)
- `ENV_NAME` - Target environment (local-mock, local-proxy, local-realtime, dev)
- `SCENARIO` - Load scenario (small, medium, large, xlarge, etc.)
- `USE_ITEM_DONE_FOR_LATENCY` - Use response.done for latency measurement for response.create (true/false)
- `WAIT_FOR_RESPONSE` - Wait for response before sending next message (true/false)
- `DEBUG` - Enable debug logging (true/false)
- `USE_WORKSPACE_PER_VU` - Enable propagate `workspace-id` unique header per VU

## Usage

Run a test script:
```bash
npm run test:local:realtime:medium
```

Or run k6 directly with custom parameters:
```bash
k6 run load_test.js -e ENV_NAME=local-realtime -e SCENARIO=medium
```

For local load testing or for direct Realtime service testing, you can use env variable `USE_WORKSPACE_PER_VU=true`
to emulate multiple workspace's requests.
