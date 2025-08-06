import 'dotenv/config';

import { IntentMatchInterface } from '@inworld/runtime/common';
import {
  ComponentFactory,
  GraphBuilder,
  NodeFactory,
} from '@inworld/runtime/graph';
import { v4 } from 'uuid';

import {
  DEFAULT_EMBEDDER_MODEL_NAME,
  DEFAULT_LLM_MODEL_NAME,
  DEFAULT_PROVIDER,
  INTENTS,
  TEXT_CONFIG,
} from '../constants';
import { bindProcessHandlers, cleanup } from '../helpers/cli_helpers';

const minimist = require('minimist');

const usage = `

Usage (Matches input text against hardcoded intents):
    yarn node-intent "hello" \n
    --embedderModelName=<model-name>[optional, used for embedding, default=${DEFAULT_EMBEDDER_MODEL_NAME}] \n
    --embedderProvider=<service-provider>[optional, used for embedding, default=${DEFAULT_PROVIDER}] \n
    --llmModelName=<model-name>[optional, used for embedding, default=${DEFAULT_EMBEDDER_MODEL_NAME}] \n
    --llmProvider=<service-provider>[optional, used for embedding, default=${DEFAULT_PROVIDER}]`;

run();

async function run() {
  const {
    text,
    embedderModelName,
    embedderProvider,
    llmModelName,
    llmProvider,
    apiKey,
  } = parseArgs();

  const embedder = ComponentFactory.createRemoteEmbedderComponent({
    id: 'embedder_component',
    provider: embedderProvider,
    modelName: embedderModelName,
    apiKey,
  });

  const llmComponent = ComponentFactory.createRemoteLLMComponent({
    id: 'llm_component',
    provider: llmProvider,
    modelName: llmModelName,
    defaultConfig: TEXT_CONFIG,
    apiKey,
  });

  const intentNode = NodeFactory.createIntentNode({
    id: 'intent_node',
    embedderComponentId: embedder.id,
    llmComponentId: llmComponent.id,
    intents: INTENTS,
    matcherConfig: {
      embedding: {
        similarityThreshold: 0.88,
      },
      llm: {
        embeddingSimilarityThreshold: 0.7,
        generationConfig: TEXT_CONFIG,
        maxEmbeddingMatchesForLlm: 5,
        promptTemplate: '',
      },
      topNIntents: 3,
    },
  });

  const graphBuilder = new GraphBuilder('node_intent_graph')
    .addComponent(embedder)
    .addComponent(llmComponent)
    .addNode(intentNode)
    .setStartNode(intentNode)
    .setEndNode(intentNode);

  console.log(graphBuilder.toJSON());

  const executor = graphBuilder.getExecutor();
  const outputStream = await executor.execute(text, v4());
  const result = (await outputStream.next()).data as IntentMatchInterface[];

  cleanup(executor, outputStream);

  console.log('Matched intents:');
  result.forEach((match, index) => {
    console.log(
      `  ${index + 1}. ${match.name} (score: ${match.score.toFixed(4)})`,
    );
  });
}

function parseArgs(): {
  text: string;
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

  const text = argv._?.join(' ') || '';
  const embedderModelName =
    argv.embedderModelName || DEFAULT_EMBEDDER_MODEL_NAME;
  const embedderProvider = argv.embedderProvider || DEFAULT_PROVIDER;
  const llmModelName = argv.llmModelName || DEFAULT_LLM_MODEL_NAME;
  const llmProvider = argv.llmProvider || DEFAULT_PROVIDER;
  const apiKey = process.env.INWORLD_API_KEY || '';

  if (!text) {
    throw new Error(`You need to provide text.\n${usage}`);
  }

  if (!apiKey) {
    throw new Error(`You need to set INWORLD_API_KEY environment variable.`);
  }

  return {
    text,
    embedderModelName,
    embedderProvider,
    llmModelName,
    llmProvider,
    apiKey,
  };
}

bindProcessHandlers();
