import 'dotenv/config';

import { InworldError } from '@inworld/runtime/common';
import { TextEmbedderFactory } from '@inworld/runtime/primitives/embedder';
import {
  EmbeddingMatcherConfig,
  IntentCompilerFactory,
  IntentMatcherFactory,
  LLMMatcherConfig,
} from '@inworld/runtime/primitives/intent';
import { LLMFactory } from '@inworld/runtime/primitives/llm';

import {
  DEFAULT_EMBEDDER_MODEL_NAME,
  DEFAULT_EMBEDDER_PROVIDER,
  DEFAULT_LLM_MODEL_NAME,
  DEFAULT_LLM_PROVIDER,
  INTENTS,
} from '../constants';

const minimist = require('minimist');

const usage = `
Usage:
    yarn basic-intent-matcher \n
    --embedder-modelName=<model-name>[optional, used for embedding, default=${DEFAULT_EMBEDDER_MODEL_NAME}] \n
    --embedder-provider=<service-provider>[optional, used for embedding, default=${DEFAULT_EMBEDDER_PROVIDER}] \n
    --llm-modelName=<model-name>[optional, used for llm, default=${DEFAULT_LLM_MODEL_NAME}] \n
    --llm-provider=<service-provider>[optional, used for llm, default=${DEFAULT_LLM_PROVIDER}]`;

// Example phrases to test intent matching
const testPhrases = [
  'Hi, how are you?',
  'I need some assistance please',
  'See you tomorrow',
  'Could you help me with something?',
  'Good morning everyone',
];

run();

async function run() {
  const {
    embedderModelName,
    embedderProvider,
    llmModelName,
    llmProvider,
    apiKey,
  } = parseArgs();

  let textEmbedder = null;
  let llm = null;
  let compiler = null;
  let matcher = null;
  let creationConfig = null;

  try {
    // Create text embedder
    console.log('Creating text embedder...');
    textEmbedder = await TextEmbedderFactory.createRemote({
      modelName: embedderModelName,
      provider: embedderProvider,
      apiKey,
    });

    // Create llm
    console.log('Creating llm...');
    llm = await LLMFactory.createRemote({
      modelName: llmModelName,
      provider: llmProvider,
      apiKey,
    });

    // Create intent compiler
    console.log('Creating intent compiler...');
    compiler = await IntentCompilerFactory.create(textEmbedder);

    // Compile the intents
    console.log('Compiling intents...');
    const compiledIntents = await compiler.compileIntents(INTENTS);

    // Create matcher configuration
    console.log('Creating matcher configuration...');
    creationConfig = {
      topNIntents: 2,
      embeddingMatcherConfig: EmbeddingMatcherConfig.getDefaultValues(),
      llmMatcherConfig: LLMMatcherConfig.getDefaultValues(),
      compiledIntents,
    };

    // Create intent matcher
    console.log('Creating intent matcher...');
    matcher = await IntentMatcherFactory.create({
      config: creationConfig,
      textEmbedder,
      llm,
    });

    // Test intent matching
    console.log('\nTesting intent matching:');
    for (const phrase of testPhrases) {
      console.log(`\nInput: "${phrase}"`);
      const matches = await matcher.matchIntents(phrase);

      console.log('Matched intents:');
      matches.forEach((match, index) => {
        console.log(
          `  ${index + 1}. ${match.name} (score: ${match.score.toFixed(4)})`,
        );
      });
    }
  } catch (error) {
    if (error instanceof InworldError) {
      console.error('Inworld Error:', error.message);
      if (error.context) {
        console.error('Context:', error.context);
      }
    } else {
      console.error('Error:', error);
    }
  } finally {
    matcher?.destroy();
    compiler?.destroy();
    textEmbedder?.destroy();
    llm?.destroy();
  }
}

function parseArgs(): {
  embedderModelName: string;
  embedderProvider: string;
  llmModelName: string;
  llmProvider: string;
  apiKey: string;
} {
  const argv = minimist(process.argv.slice(2));

  if (argv.help) {
    console.log(usage);
    process.exit(0);
  }

  const embedderModelName =
    argv.embedderModelName || DEFAULT_EMBEDDER_MODEL_NAME;
  const embedderProvider = argv.embedderProvider || DEFAULT_EMBEDDER_PROVIDER;
  const llmModelName = argv.llmModelName || DEFAULT_LLM_MODEL_NAME;
  const llmProvider = argv.llmProvider || DEFAULT_LLM_PROVIDER;
  const apiKey = process.env.INWORLD_API_KEY || '';

  return {
    embedderModelName,
    embedderProvider,
    llmModelName,
    llmProvider,
    apiKey,
  };
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
