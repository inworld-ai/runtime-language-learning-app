import 'dotenv/config';

import { v4 } from 'uuid';

import {
  DEFAULT_EMBEDDER_MODEL_NAME,
  DEFAULT_LLM_MODEL_NAME,
  DEFAULT_PROVIDER,
  INTENTS,
  TEXT_CONFIG_SDK,
} from '../../constants';
import { bindProcessHandlers, cleanup } from '../../helpers/cli_helpers';

const minimist = require('minimist');

import { IntentMatchInterface } from '@inworld/runtime/common';
import {
  ComponentFactory,
  CustomInputDataType,
  CustomOutputDataType,
  CustomOutputDataTypeTyped,
  GraphBuilder,
  NodeFactory,
  registerCustomNodeType,
} from '@inworld/runtime/graph';

const greetingNodeType = registerCustomNodeType(
  'GreetingNode',
  [CustomInputDataType.MATCHED_INTENTS],
  CustomOutputDataType.TEXT,
  (_context, _inputs) => {
    return 'It is a greeting';
  },
);

const farewellNodeType = registerCustomNodeType(
  'FarewellNode',
  [CustomInputDataType.MATCHED_INTENTS],
  CustomOutputDataType.TEXT,
  (_context, _inputs) => {
    return 'It is a farewell';
  },
);

const intentMatchUnwrapNodeType = registerCustomNodeType(
  'IntentMatchUnwrapNode',
  [CustomInputDataType.MATCHED_INTENTS],
  CustomOutputDataTypeTyped<{ intent_name: string; intent_score: number }>(),
  (_context, inputs) => {
    return {
      intent_name: inputs.getMatchers()[0].name,
      intent_score: inputs.getMatchers()[0].score,
    };
  },
);

const usage = `
Usage:
    yarn conditional-edges-after-intent "Hello" \n
    --embedder-modelName=<model-name>[optional, used for embedding, default=${DEFAULT_EMBEDDER_MODEL_NAME}] \n
    --embedder-provider=<service-provider>[optional, used for embedding, default=${DEFAULT_PROVIDER}] \n
    --llm-modelName=<model-name>[optional, used for embedding, default=${DEFAULT_EMBEDDER_MODEL_NAME}] \n
    --llm-provider=<service-provider>[optional, used for embedding, default=${DEFAULT_PROVIDER}]
Description:
    This example demonstrates how to create a graph with conditional edges.
    It will detect intents in the input text and route the execution to different custom nodes based on the detected intent.`;

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

  // Create components
  const embedderComponent = ComponentFactory.createRemoteEmbedderComponent({
    id: 'embedder_component_id',
    provider: embedderProvider,
    modelName: embedderModelName,
    apiKey,
  });

  const llmComponent = ComponentFactory.createRemoteLLMComponent({
    id: 'llm_component_id',
    provider: llmProvider,
    modelName: llmModelName,
    apiKey,
  });

  // Create nodes
  const intentNode = NodeFactory.createIntentNode({
    id: 'intent-node',
    embedderComponentId: 'embedder_component_id',
    llmComponentId: 'llm_component_id',
    intents: INTENTS,
    matcherConfig: {
      embedding: {
        similarityThreshold: 0.7,
      },
      llm: {
        embeddingSimilarityThreshold: 0.7,
        maxEmbeddingMatchesForLlm: 5,
        promptTemplate: '',
        generationConfig: TEXT_CONFIG_SDK,
      },
      topNIntents: 3,
    },
    reportToClient: true,
  });

  const greetingNode = NodeFactory.createCustomNode(
    'greeting-node',
    greetingNodeType,
  );

  const farewellNode = NodeFactory.createCustomNode(
    'farewell-node',
    farewellNodeType,
  );

  const intentMatchUnwrapNode = NodeFactory.createCustomNode(
    'intent-match-unwrap-node',
    intentMatchUnwrapNodeType,
  );

  // Build graph with conditional edges
  const graphBuilder = new GraphBuilder('conditional_edges_after_intent_graph')
    .addComponent(embedderComponent)
    .addComponent(llmComponent)
    .addNode(intentNode)
    .addNode(greetingNode)
    .addNode(farewellNode)
    .addNode(intentMatchUnwrapNode)
    .addEdge(intentNode, intentMatchUnwrapNode)
    .addEdge(intentMatchUnwrapNode, greetingNode, {
      conditionExpression: 'input.intent_name == "greeting"',
    })
    .addEdge(intentMatchUnwrapNode, farewellNode, {
      conditionExpression: 'input.intent_name == "farewell"',
    })
    .setStartNode(intentNode)
    .setEndNodes([greetingNode, farewellNode]);

  console.log(graphBuilder.toJSON());

  const executor = graphBuilder.getExecutor();

  const outputStream = await executor.execute(text, v4());

  const intentResult = (await outputStream.next())
    .data as IntentMatchInterface[];
  const customNodeResult = (await outputStream.next()).data as string;

  console.log('Matched intents:');
  intentResult.forEach((match, index) => {
    console.log(
      `  ${index + 1}. ${match.name} (score: ${match.score.toFixed(4)})`,
    );
  });

  console.log(`Custom node result: ${customNodeResult}`);
  cleanup(executor, outputStream);
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
