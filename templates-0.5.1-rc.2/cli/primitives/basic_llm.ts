import 'dotenv/config';

import {
  DEFAULT_LLM_MODEL_NAME,
  DEFAULT_LLM_PROVIDER,
  DEFAULT_LOCAL_LLM_MODEL_PATH,
  Modes,
  TEXT_CONFIG_SDK,
} from '../constants';

const minimist = require('minimist');
import { InworldError } from '@inworld/runtime/common';
import { DeviceRegistry, DeviceType } from '@inworld/runtime/core';
import { LLM, LLMFactory } from '@inworld/runtime/primitives/llm';

const usage = `
Usage:
    yarn basic-llm "Hello, how are you?" \n
    --mode=remote|local[optional, default=remote] \n
    --modelPath=<path-to-model-directory>[optional, required for local mode] \n
    --modelName=<model-name>[optional, required for remote mode, default=${DEFAULT_LLM_MODEL_NAME}] \n
    --provider=<service-provider>[optional, default=inworld] \n
    --tools[optional, enable tool calling demonstration]`;

run();

async function run() {
  const { mode, prompt, modelPath, modelName, provider, apiKey, tools } =
    parseArgs();

  let llm;

  if (mode === Modes.LOCAL) {
    const found = DeviceRegistry.getAvailableDevices().find(
      (d) => d.getType() === DeviceType.CUDA,
    );
    llm = await LLMFactory.createLocal({ modelPath, device: found });
  } else {
    llm = await LLMFactory.createRemote({ provider, modelName, apiKey });
  }

  if (tools) {
    await demonstrateToolCalling(llm);
  } else {
    await demonstrateTextGeneration(llm, prompt);
  }

  llm.destroy();
}

async function demonstrateTextGeneration(llm: any, prompt: string) {
  const messages = [
    {
      role: 'user',
      content: prompt,
    },
  ];

  const response = await llm.generateText({
    messages,
    config: TEXT_CONFIG_SDK,
  });
  let responseText = '';
  let chunk = await response.next();

  while (!chunk.done) {
    responseText += chunk.text;
    chunk = await response.next();
  }

  console.log(`Response: ${responseText}`);
}

async function demonstrateToolCalling(llm: LLM) {
  const tools = [
    {
      name: 'calculator',
      description: 'Evaluate a mathematical expression',
      properties: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: 'The mathematical expression to evaluate',
          },
        },
        required: ['expression'],
      },
    },
    {
      name: 'get_weather',
      description: 'Get the current weather in a location',
      properties: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'The city and state, e.g., San Francisco, CA',
          },
        },
        required: ['location'],
      },
    },
  ];

  const messages = [
    {
      role: 'system',
      content: 'You are a helpful assistant that can use tools when needed.',
    },
    {
      role: 'user',
      content:
        'Tell me the weather in Vancouver and evaluate the expression 2 + 2',
    },
  ];

  console.log('Demonstrating tool calling functionality...');
  console.log('Input messages:');
  for (const message of messages) {
    console.log(`  Role: ${message.role}, Content: ${message.content}`);
  }

  const response = await llm.generateContentStream({
    messages,
    config: TEXT_CONFIG_SDK,
    tools,
  });

  let responseText = '';
  let chunk = await response.next();

  while (!chunk.done) {
    responseText += chunk.text;

    if (chunk.toolCalls && chunk.toolCalls.length > 0) {
      console.log('\nTool calls detected:');
      for (const toolCall of chunk.toolCalls) {
        console.log(`  Tool: ${toolCall.name}`);
        console.log(`    ID: ${toolCall.id}`);
        console.log(`    Arguments: ${toolCall.args}`);
      }
    }

    chunk = await response.next();
  }

  console.log(`\nFinal response: ${responseText}`);
}

function parseArgs(): {
  prompt: string;
  mode: Modes;
  modelPath: string;
  modelName: string;
  provider: string;
  apiKey: string;
  tools: boolean;
} {
  const argv = minimist(process.argv.slice(2));

  if (argv.help) {
    console.log(usage);
    process.exit(0);
  }

  const mode = argv.mode === Modes.LOCAL ? Modes.LOCAL : Modes.REMOTE;
  const prompt = argv._?.join(' ') || '';
  const modelPath = argv.modelPath || '';
  const modelName = argv.modelName || DEFAULT_LLM_MODEL_NAME;
  const provider = argv.provider || DEFAULT_LLM_PROVIDER;
  const apiKey = process.env.INWORLD_API_KEY || '';
  const tools = !!argv.tools;

  if (!prompt) {
    throw new Error(`You need to provide a prompt.\n${usage}`);
  }

  if (mode === Modes.REMOTE) {
    if (!apiKey) {
      throw new Error(
        `You need to set INWORLD_API_KEY environment variable.\n${usage}`,
      );
    }
  } else if (!modelPath) {
    throw new Error(
      `You need to specify a model path for local mode. Use --modelPath=${DEFAULT_LOCAL_LLM_MODEL_PATH} for the default model.\n${usage}`,
    );
  }

  return { prompt, mode, modelPath, modelName, provider, apiKey, tools };
}

function done() {
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
