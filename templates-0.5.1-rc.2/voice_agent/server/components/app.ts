import { VADFactory } from '@inworld/runtime/primitives/vad';
import { promises } from 'fs';
import * as path from 'path';
import { v4 } from 'uuid';
const { validationResult } = require('express-validator');

import { parseEnvironmentVariables } from '../helpers';
import { Connection } from '../types';
import { InworldGraphWrapper } from './graph';

export class InworldApp {
  apiKey: string;
  llmModelName: string;
  llmProvider: string;
  voiceId: string;
  vadModelPath: string;
  graphVisualizationEnabled: boolean;
  ttsModelId: string;
  connections: {
    [key: string]: Connection;
  } = {};

  vadClient: any;

  graphWithAudioInput: InworldGraphWrapper;
  graphWithTextInput: InworldGraphWrapper;

  promptTemplate: string;

  async initialize() {
    this.connections = {};

    // Parse the environment variables
    const env = parseEnvironmentVariables();

    this.apiKey = env.apiKey;
    this.llmModelName = env.llmModelName;
    this.llmProvider = env.llmProvider;
    this.voiceId = env.voiceId;
    this.vadModelPath = env.vadModelPath;
    this.graphVisualizationEnabled = env.graphVisualizationEnabled;
    this.ttsModelId = env.ttsModelId;

    // Initialize the prompt template
    this.promptTemplate = await promises.readFile(
      path.join(__dirname, '..', '..', '..', 'prompts', 'dialog_prompt.jinja'),
      'utf8',
    );

    // Initialize the VAD client
    console.log('Loading VAD model from:', this.vadModelPath);
    this.vadClient = await VADFactory.createLocal({
      modelPath: this.vadModelPath,
    });

    this.graphWithTextInput = await InworldGraphWrapper.create({
      apiKey: this.apiKey,
      llmModelName: this.llmModelName,
      llmProvider: this.llmProvider,
      voiceId: this.voiceId,
      connections: this.connections,
      graphVisualizationEnabled: this.graphVisualizationEnabled,
      ttsModelId: this.ttsModelId,
    });

    this.graphWithAudioInput = await InworldGraphWrapper.create({
      apiKey: this.apiKey,
      llmModelName: this.llmModelName,
      llmProvider: this.llmProvider,
      voiceId: this.voiceId,
      connections: this.connections,
      withAudioInput: true,
      graphVisualizationEnabled: this.graphVisualizationEnabled,
      ttsModelId: this.ttsModelId,
    });
  }

  async load(req: any, res: any) {
    res.setHeader('Content-Type', 'application/json');

    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const agent = {
      ...req.body.agent,
      id: v4(),
    };

    this.connections[req.query.key] = {
      state: {
        messages: [
          {
            role: 'system',
            content: this.createSystemMessage(agent),
            id: v4(),
          },
        ],
        agent,
        userName: req.body.userName,
      },
      ws: null,
    };

    res.end(JSON.stringify({ agent }));
  }

  private createSystemMessage(agent: any) {
    return `You are: "${agent.name}". Your persona is: "${agent.description}". Your motivation is: "${agent.motivation}".`;
  }

  unload(req: any, res: any) {
    res.setHeader('Content-Type', 'application/json');

    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    delete this.connections[req.query.key];

    res.end(JSON.stringify({ message: 'Session unloaded' }));
  }

  shutdown() {
    this.connections = {};
    this.graphWithTextInput.destroy();
    this.graphWithAudioInput.destroy();
  }
}
