# Inworld Realtime Service

This is an Inworld service that implements a web-sockets OpenAI Realtime API compatible API.

## Building and Running with Docker

### Build Docker Image

```bash
make docker-build
```

Optionally, you can provide a GitHub token to download `@inworld/runtime` binaries:

```bash
GH_TOKEN=your_token make docker-build
```

### Run Docker Container

```bash
make docker-run
```

This will run the container on port 4000. Make sure you have a `.env` file in the root directory with the required environment variables.

## Building and Running without Docker

### Install Dependencies

```bash
cd src
npm install
```

### Build Project

```bash
cd src
npm run build
```

### Run the Server

For development (with nodemon):

```bash
cd src
npm start
```

The server will start on port 4000 by default (or the port specified in your environment variables).

## Configuration

### Logging

The service outputs JSON logs by default (Google Cloud Logging compatible).

**Environment Variables:**
- `REALTIME_LOG_LEVEL` - Log level: `debug`, `info`, `warn`, `error` (default: `info`)
- `REALTIME_LOG_PRETTY` - Set to `1` for human-readable logs during development (default: `0` = JSON)

**Examples:**
```bash
npm start                                      # JSON logs (production-ready)
REALTIME_LOG_PRETTY=1 npm start                # Pretty logs (local dev)
REALTIME_LOG_LEVEL=debug npm start             # JSON with debug level
REALTIME_LOG_PRETTY=1 REALTIME_LOG_LEVEL=debug npm start  # Pretty with debug level
```

See [LOGGING.md](LOGGING.md) for detailed logging best practices.

## Test websocket connection
### Locally running w-proxy and realtime service
```
ws://localhost:8081/api/v1/realtime/session?key=<session-id>&protocol=realtime
```
with Authorization header

### Dev: running w-proxy and realtime service
```
wss://api.dev.inworld.ai:443/api/v1/realtime/session?key=<session-id>&protocol=realtime
```
with Authorization header

### Dev: tailscale and directly to realtime service
```
ws://realtime-service-dev.tail4c73a.ts.net:4000/session?key=<session-id>&protocol=realtime
```
no need to provide Authorization header (debug only)
