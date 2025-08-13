import 'dotenv/config';

import { InworldError } from '@inworld/runtime/common';
import cors from 'cors';
import express from 'express';
import { createServer } from 'http';
import { parse } from 'url';
import { RawData, WebSocketServer } from 'ws';

const { query } = require('express-validator');

import { body } from 'express-validator';

import { WS_APP_PORT } from '../constants';
import { InworldApp } from './components/app';
import { MessageHandler } from './components/message_handler';

const app = express();
const server = createServer(app);
const webSocket = new WebSocketServer({ noServer: true });

app.use(cors());
app.use(express.json());
app.use(express.static('frontend'));

const inworldApp = new InworldApp();

webSocket.on('connection', (ws, request) => {
  const { query } = parse(request.url!, true);
  const key = query.key?.toString();

  if (!inworldApp.connections?.[key]) {
    throw new Error('Session not found!');
  }

  inworldApp.connections[key].ws = inworldApp.connections[key].ws ?? ws;

  ws.on('error', console.error);

  const messageHandler = new MessageHandler(inworldApp, (data: any) =>
    ws.send(JSON.stringify(data)),
  );

  ws.on('message', (data: RawData) => messageHandler.handleMessage(data, key));
});

app.post(
  '/load',
  query('key').trim().isLength({ min: 1 }),
  body('agent').isObject(),
  body('userName').trim().isLength({ min: 1 }),
  inworldApp.load.bind(inworldApp),
);

app.post(
  '/unload',
  query('key').trim().isLength({ min: 1 }),
  inworldApp.unload.bind(inworldApp),
);

server.on('upgrade', async (request, socket, head) => {
  const { pathname } = parse(request.url!);

  if (pathname === '/session') {
    webSocket.handleUpgrade(request, socket, head, (ws) => {
      webSocket.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

server.listen(WS_APP_PORT, async () => {
  try {
    await inworldApp.initialize();
  } catch (error) {
    console.error(error);
  }

  console.log(`Server is running on port ${WS_APP_PORT}`);
});

function done() {
  console.log('Server is closing');

  inworldApp.shutdown();

  process.exit(0);
}

process.on('SIGINT', done);
process.on('SIGTERM', done);
process.on('SIGUSR2', done);
process.on('unhandledRejection', (err: Error) => {
  if (err instanceof InworldError) {
    console.error('Inworld Error: ', {
      message: err.message,
      context: err.context,
    });
  } else {
    console.error(err.message);
  }
  process.exit(1);
});
