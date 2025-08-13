import 'dotenv/config';

import { InworldError } from '@inworld/runtime/common';
import { DeviceRegistry, DeviceType } from '@inworld/runtime/core';
import { TextEmbedderFactory } from '@inworld/runtime/primitives/embedder';

import { DEFAULT_EMBEDDER_MODEL_NAME, Modes } from '../constants';
const minimist = require('minimist');

const usage = `
Usage:
    yarn basic-embedder \n
    --mode=remote|local[optional, default=remote] \n
    --modelPath=<path-to-model>[optional, required for local mode] \n
    --modelName=<model-name>[optional, required for remote mode, default=${DEFAULT_EMBEDDER_MODEL_NAME}] \n
    --provider=<service-provider>[optional, default=inworld]`;

const texts = [
  'Hello, how are you?',
  'Hi, how are you doing?',
  'The weather is nice today.',
];

run();

async function run() {
  const { mode, modelPath, modelName, provider, apiKey } = parseArgs();

  let embedder;

  try {
    if (mode === Modes.LOCAL) {
      const found = DeviceRegistry.getAvailableDevices().find(
        (d: any) => d.getType() === DeviceType.CPU,
      );

      embedder = await TextEmbedderFactory.createTextEmbedder({
        type: 'local',
        config: {
          modelPath,
          device: found,
        },
      });
    } else {
      embedder = await TextEmbedderFactory.createTextEmbedder({
        type: 'remote',
        config: {
          modelName,
          provider,
          apiKey,
        },
      });
    }

    // Get embeddings for individual texts
    console.log('Getting embeddings for individual texts:');
    for (const text of texts) {
      const embedding = await embedder.embed(text);
      console.log(`Text: '${text}'`);
      console.log(`Embedding shape: ${embedding.length}`);
    }

    // Get embeddings for batch of texts
    console.log('\nGetting embeddings for batch of texts:');
    const embeddings = await embedder.embedBatch(texts);
    console.log(`Number of embeddings: ${embeddings.length}`);
    console.log(`Embedding dimension: ${embeddings[0].length}`);
  } catch (error) {
    if (error instanceof InworldError) {
      console.error('Inworld Error:', {
        message: error.message,
        context: error.context,
      });
    } else {
      console.error('Error:', error.message);
    }
    process.exit(1);
  } finally {
    embedder?.destroy();
  }
}

function parseArgs(): {
  mode: Modes;
  modelPath: string;
  modelName: string;
  provider: string;
  apiKey: string;
} {
  const argv = minimist(process.argv.slice(2));

  if (argv.help) {
    console.log(usage);
    process.exit(0);
  }

  const mode = argv.mode === Modes.LOCAL ? Modes.LOCAL : Modes.REMOTE;
  const modelPath = argv.modelPath || '';
  const modelName = argv.modelName || DEFAULT_EMBEDDER_MODEL_NAME;
  const provider = argv.provider || 'inworld';
  const apiKey = process.env.INWORLD_API_KEY || '';

  if (mode === Modes.REMOTE) {
    if (!apiKey) {
      throw new Error(
        `You need to set INWORLD_API_KEY environment variable.\n${usage}`,
      );
    }
  } else if (!modelPath) {
    throw new Error(
      `You need to specify a model path for local mode.\n${usage}`,
    );
  }

  return { mode, modelPath, modelName, provider, apiKey };
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
