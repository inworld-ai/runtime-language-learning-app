import ws from 'k6/ws';
import {check} from 'k6';
import {Rate, Trend, Counter} from 'k6/metrics';

const connectionLatency = new Trend('ws_connection_latency', true);
const responseLatency = new Trend('ws_response_latency', true);
const connectionSuccessRate = new Rate('ws_connection_success');
const messageSuccessRate = new Rate('ws_message_success');
const messagesSentCounter = new Counter('ws_messages_sent_total');
const messagesReceivedCounter = new Counter('ws_messages_received_total');
const websocketErrorCounter = new Counter('websocket_errors_total');

// Configuration from environment variables
const INWORLD_API_KEY = __ENV.INWORLD_API_KEY || '';
const VU_ID = __VU;
const ENV_NAME = __ENV.ENV_NAME || 'local-mock';
const IS_DEBUG = __ENV.DEBUG === 'true';
const USE_WORKSPACE_PER_VU = __ENV.USE_WORKSPACE_PER_VU === 'true';
const USE_ITEM_DONE_FOR_LATENCY = __ENV.USE_ITEM_DONE_FOR_LATENCY === 'true';
const WAIT_FOR_RESPONSE = __ENV.WAIT_FOR_RESPONSE === 'true';

let baseWsUrl;
// Select the base URL based on the environment name
switch (ENV_NAME.toLowerCase()) {
  case 'local-proxy':
    // local w-proxy
    baseWsUrl = 'ws://localhost:8081/api/v1/realtime/session';
    break;
  case 'local-realtime':
    // local realtime
    baseWsUrl = 'ws://localhost:4000/session';
    break;
  case 'dev':
    // dev Realtime service
    baseWsUrl = 'wss://api.dev.inworld.ai:443/api/v1/realtime/session';
    break;
  case 'local-mock':
  default:
    // local mock web-socket server
    baseWsUrl = 'ws://localhost:9002/api/v1/realtime/session';
    break;
}

const WS_URL = `${baseWsUrl}?protocol=realtime`;
console.log(`[Config] Running test against environment: ${ENV_NAME}. URL: ${WS_URL}`);
console.log(`[Config] USE_ITEM_DONE_FOR_LATENCY: ${USE_ITEM_DONE_FOR_LATENCY} (latency for response.create will be measured from response.done)`);
console.log(`[Config] WAIT_FOR_RESPONSE: ${WAIT_FOR_RESPONSE} (send next message only after receiving response to previous)`);

// Messages to send
const messages = [
  {type: 'session.update', session: {instructions: 'You are a helpful assistant that speaks in a friendly tone.'}},
  {type: 'session.update', session: {audio: {output: {voice: 'Alex'}}}},
  {type: 'session.update', session: {output_modalities: ["text"]}},
  {
    type: 'conversation.item.create',
    item: {type: 'message', role: 'user', content: [{type: 'input_text', text: 'What is 2+2?'}]}
  },
  {type: 'response.create'}
];

const scenarios = {
  small: [
    { duration: '5s', target: 1 },
    { duration: '5s', target: 3 },
    { duration: '5s', target: 5 },
    { duration: '5s', target: 5 },
    { duration: '5s', target: 0 },
  ],

  medium: [
    { duration: '5s', target: 5 },
    { duration: '5s', target: 8 },
    { duration: '5s', target: 15 },
    { duration: '10s', target: 15 },
    { duration: '5s', target: 0 },
  ],

  xmedium: [
    { duration: '5s', target: 10 },
    { duration: '5s', target: 15 },
    { duration: '5s', target: 25 },
    { duration: '10s', target: 25 },
    { duration: '5s', target: 0 },
  ],

  x2medium: [
    { duration: '5s', target: 20 },
    { duration: '5s', target: 30 },
    { duration: '5s', target: 50 },
    { duration: '10s', target: 50 },
    { duration: '5s', target: 0 },
  ],

  x2mediumLong: [
    { duration: '10s', target: 20 },
    { duration: '10s', target: 30 },
    { duration: '10s', target: 50 },
    { duration: '30s', target: 50 },
    { duration: '10s', target: 0 },
  ],

  large: [
    { duration: '10s', target: 20 },
    { duration: '10s', target: 50 },
    { duration: '10s', target: 80 },
    { duration: '10s', target: 100 },
    { duration: '30s', target: 100 },
    { duration: '10s', target: 0 },
  ],

  xlarge: [
    { duration: '10s', target: 20 },
    { duration: '10s', target: 50 },
    { duration: '10s', target: 80 },
    { duration: '10s', target: 100 },
    { duration: '10s', target: 150 },
    { duration: '10s', target: 200 },
    { duration: '30s', target: 200 },
    { duration: '10s', target: 0 },
  ],
};

const scenarioName = __ENV.SCENARIO || "small";

// Dynamically create metrics for each message
const messageLatencies = [];
const messageSuccessRates = [];

for (let i = 0; i < messages.length; i++) {
  const messageIndex = i + 1; // 1-based index for metric names
  messageLatencies.push(new Trend(`message${messageIndex}_latency`, true));
  messageSuccessRates.push(new Rate(`message${messageIndex}_success`));
}

export const options = {
  stages: scenarios[scenarioName],
  thresholds: {
    'ws_connection_success': ['rate>0.95'],
    'ws_message_success': ['rate>0.95'],
    'ws_connection_latency': ['p(95)<1000'],
    'ws_response_latency': ['p(95)<5000'],
  },
  summaryTrendStats: ["min", "max", "avg", "med", "p(90)", "p(95)", "p(99)", "p(99.9)"],
};

export default function () {
  const sessionKey = `test-session-${VU_ID}-${Date.now()}`;
  const url = `${WS_URL}&key=${sessionKey}`;
  const params = {
    tags: {name: 'WebSocket Connection'},
    headers: {},
  };
  if (INWORLD_API_KEY) {
    params.headers['Authorization'] = `Basic ${INWORLD_API_KEY}`;
  }

  if (USE_WORKSPACE_PER_VU) {
    params.headers['workspace-id'] = `workspace-${VU_ID}}`;
    console.log(`[VU ${VU_ID}] Using workspace-id: ${params.headers['workspace-id']}`);
  }

  const connectionStart = Date.now();

  const response = ws.connect(url, params, function (socket) {
    const connectionEnd = Date.now();
    const connectionTime = connectionEnd - connectionStart;
    connectionLatency.add(connectionTime);
    connectionSuccessRate.add(1);

    // Track message sending and response times
    const pendingMessages = new Map();
    const pendingResponseCreate = new Map();
    let receivedMessageCount = 0;
    let sessionCreatedReceived = false;
    let allMessagesSent = false;
    let currentMessageIndex = 0;

    const sendMessage = function (index) {
      if (index >= messages.length) {
        allMessagesSent = true;
        return;
      }

      const messageStart = Date.now();
      const isResponseCreate = messages[index].type === 'response.create';

      if (USE_ITEM_DONE_FOR_LATENCY && isResponseCreate) {
        pendingResponseCreate.set(index, {sentTime: messageStart});
      } else {
        pendingMessages.set(index, {sentTime: messageStart, responded: false});
      }

      messagesSentCounter.add(1);
      socket.send(JSON.stringify(messages[index]));

      if (IS_DEBUG) {
        console.log(`[VU ${VU_ID}] Sent message ${index + 1}/${messages.length}:`, messages[index].type);
      }

      socket.setTimeout(() => {
        if (USE_ITEM_DONE_FOR_LATENCY && isResponseCreate) {
          if (pendingResponseCreate.has(index)) {
            pendingResponseCreate.delete(index);
            messageSuccessRate.add(0);
            if (index >= 0 && index < messageSuccessRates.length) {
              messageSuccessRates[index].add(0);
            }
            if (IS_DEBUG) {
              console.log(`[VU ${VU_ID}] Timeout waiting for response.done for message ${index + 1}`);
            }
          }
        } else {
          if (pendingMessages.has(index) && !pendingMessages.get(index).responded) {
            pendingMessages.delete(index);
            messageSuccessRate.add(0);
            if (index >= 0 && index < messageSuccessRates.length) {
              messageSuccessRates[index].add(0);
            }
            if (IS_DEBUG) {
              console.log(`[VU ${VU_ID}] Timeout waiting for response to message ${index + 1}`);
            }
          }
        }
      }, 10000);
    };

    socket.on('open', () => {
      if (IS_DEBUG) {
        console.log(`[VU ${VU_ID}] WebSocket connection opened to url ${url}`);
      }

      // Send the first message immediately
      if (messages.length > 0) {
        sendMessage(0);
        currentMessageIndex = 1;
      }

      if (!WAIT_FOR_RESPONSE) {
        // In timed mode, send messages with delays
        for (let index = 1; index < messages.length; index++) {
          socket.setTimeout(() => {
            sendMessage(index);
          }, index * 50);
        }

        socket.setTimeout(() => {
          allMessagesSent = true;
        }, (messages.length - 1) * 50);
      }
    });

    socket.on('message', (data) => {
      const ts = Date.now();
      messagesReceivedCounter.add(1);

      let msg;
      try { msg = JSON.parse(data); }
      catch { if (IS_DEBUG) console.log("Non-JSON message"); return; }

      const type = msg.type || "unknown";
      if (IS_DEBUG) console.log(`[VU ${VU_ID}] Received: ${type}`);

      if (type === 'session.created') {
        sessionCreatedReceived = true;
        return;
      }

      if (USE_ITEM_DONE_FOR_LATENCY && type === "response.done") {
        handleResponseDone(ts);
      } else {
        handleRegularResponse(ts);
      }

      attemptSendNextMessage();
      tryCloseSocket();
    });


    function handleResponseDone(ts) {
      if (pendingResponseCreate.size === 0) {
        if (IS_DEBUG) console.log("response.done received without a pending response.create");
        return;
      }

      const [index, entry] = [...pendingResponseCreate.entries()].sort(([a],[b]) => a - b)[0];
      pendingResponseCreate.delete(index);

      const latency = Math.max(0, ts - entry.sentTime);
      recordSuccess(index, latency);

      if (IS_DEBUG) {
        console.log(`[VU ${VU_ID}] response.done matched message ${index+1}, latency: ${latency}ms`);
      }
    }

    function handleRegularResponse(ts) {
      if (pendingMessages.size === 0) {
        if (IS_DEBUG) console.log("Response w/o pendingMessages");
        return;
      }

      const [index, entry] = [...pendingMessages.entries()].sort(([a],[b]) => a - b)[0];
      pendingMessages.delete(index);

      let latency = ts - entry.sentTime;
      if (latency < 0) latency = 0;
      if (latency === 0) latency = 0.5;

      recordSuccess(index, latency);

      if (IS_DEBUG) {
        console.log(`[VU ${VU_ID}] matched response for message ${index+1}, latency: ${latency}ms`);
      }
    }

    function recordSuccess(index, latency) {
      responseLatency.add(latency);
      messageSuccessRate.add(1);

      if (index >= 0 && index < messageLatencies.length) {
        messageLatencies[index].add(latency);
        messageSuccessRates[index].add(1);
      }
    }

    function attemptSendNextMessage() {
      if (!WAIT_FOR_RESPONSE) return;
      if (currentMessageIndex >= messages.length) return;

      socket.setTimeout(() => {
        sendMessage(currentMessageIndex);
        currentMessageIndex++;
        if (currentMessageIndex >= messages.length) allMessagesSent = true;
      }, 50);
    }

    function tryCloseSocket() {
      const pendingCount =
        pendingMessages.size +
        (USE_ITEM_DONE_FOR_LATENCY ? pendingResponseCreate.size : 0);

      if (!allMessagesSent || pendingCount > 0) return;

      if (IS_DEBUG) {
        console.log(`[VU ${VU_ID}] All responses received. Closing socket.`);
      }

      socket.close();
    }

    socket.on('error', function (e) {
      console.error(`[VU ${VU_ID}] WebSocket error:`, e.error());
      websocketErrorCounter.add(1);
      connectionSuccessRate.add(0);
      check(false, {'WebSocket connection must not have errors': e.error() == undefined});
    });

    socket.on('close', () => {
      if (IS_DEBUG) {
        console.log(`[VU ${VU_ID}] Connection closed`);
      }

      for (const [msgIndex, entry] of pendingMessages.entries()) {
        if (!entry.responded) {
          messageSuccessRate.add(0);
          if (msgIndex >= 0 && msgIndex < messageSuccessRates.length) {
            messageSuccessRates[msgIndex].add(0);
          }
        }
      }
      pendingMessages.clear();

      if (USE_ITEM_DONE_FOR_LATENCY) {
        for (const [msgIndex, entry] of pendingResponseCreate.entries()) {
          messageSuccessRate.add(0);
          if (msgIndex >= 0 && msgIndex < messageSuccessRates.length) {
            messageSuccessRates[msgIndex].add(0);
          }
        }
        pendingResponseCreate.clear();
      }
    });

    const safetyTimeout = (messages.length * 1000) + 1000;

    socket.setTimeout(() => {
      const pendingCount = pendingMessages.size + (USE_ITEM_DONE_FOR_LATENCY ? pendingResponseCreate.size : 0);
      if (IS_DEBUG) {
        console.log(`[VU ${VU_ID}] Safety timeout - closing connection. Sent: ${messages.length}, Received: ${receivedMessageCount}, Pending: ${pendingCount}`);
      }

      for (const [msgIndex, entry] of pendingMessages.entries()) {
        if (!entry.responded) {
          messageSuccessRate.add(0);
          if (msgIndex >= 0 && msgIndex < messageSuccessRates.length) {
            messageSuccessRates[msgIndex].add(0);
          }
        }
      }
      pendingMessages.clear();

      if (USE_ITEM_DONE_FOR_LATENCY) {
        for (const [msgIndex, entry] of pendingResponseCreate.entries()) {
          messageSuccessRate.add(0);
          if (msgIndex >= 0 && msgIndex < messageSuccessRates.length) {
            messageSuccessRates[msgIndex].add(0);
          }
        }
        pendingResponseCreate.clear();
      }

      socket.close();
    }, safetyTimeout);
  });

  check(response, {
    'WebSocket connection established': (r) => r && r.status === 101,
  }, {name: 'Connection Check'});

  if (!response || response.status !== 101) {
    connectionSuccessRate.add(0);
    const connectionTime = Date.now() - connectionStart;
    connectionLatency.add(connectionTime);
  }
}
