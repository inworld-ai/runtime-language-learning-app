import 'dotenv/config';

import {
  DEFAULT_EMBEDDER_MODEL_NAME,
  DEFAULT_EMBEDDER_PROVIDER,
  DEFAULT_LLM_MODEL_NAME,
  DEFAULT_LLM_PROVIDER,
  INTENTS,
} from '../../constants';
import { bindProcessHandlers } from '../../helpers/cli_helpers';

const minimist = require('minimist');

import {
  CustomNode,
  GraphBuilder,
  GraphTypes,
  ProcessContext,
  ProxyNode,
  SubgraphNode,
} from '@inworld/runtime/graph';

type IntentMatchUnwrapOutput = {
  intent_name: string;
  intent_score: number;
};

class GreetingNode extends CustomNode {
  process(_context: ProcessContext, _input: GraphTypes.MatchedIntents): string {
    return 'It is a greeting';
  }
}

class FarewellNode extends CustomNode {
  process(_context: ProcessContext, _input: GraphTypes.MatchedIntents): string {
    return 'It is a farewell';
  }
}

class IntentMatchUnwrapNode extends CustomNode {
  process(
    _context: ProcessContext,
    _input: GraphTypes.MatchedIntents,
  ): GraphTypes.Custom<IntentMatchUnwrapOutput> {
    return {
      intent_name: _input.intents[0].name,
      intent_score: _input.intents[0].score,
    };
  }
}

const usage = `
Usage:
    yarn conditional-edges-after-intent "Hello" \n
    --embedder-modelName=<model-name>[optional, used for embedding, default=${DEFAULT_EMBEDDER_MODEL_NAME}] \n
    --embedder-provider=<service-provider>[optional, used for embedding, default=${DEFAULT_EMBEDDER_PROVIDER}] \n
    --llm-modelName=<model-name>[optional, used for embedding, default=${DEFAULT_EMBEDDER_MODEL_NAME}] \n
    --llm-provider=<service-provider>[optional, used for embedding, default=${DEFAULT_LLM_PROVIDER}]
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

  const builtInIntentSubgraphNode = new SubgraphNode({
    subgraphId: 'intent_subgraph',
  });

  const greetingNode = new GreetingNode();

  const farewellNode = new FarewellNode();

  const proxyNode = new ProxyNode({
    reportToClient: true,
  });

  const intentMatchUnwrapNode = new IntentMatchUnwrapNode();

  // Build graph with conditional edges
  const graph = new GraphBuilder({
    id: 'conditional_edges_after_intent_graph',
    apiKey,
    enableRemoteConfig: false,
  })
    .addIntentSubgraph('intent_subgraph', {
      intents: INTENTS,
      promptTemplate: '',
      llmComponent: {
        provider: llmProvider,
        modelName: llmModelName,
      },
      embedderComponent: {
        provider: embedderProvider,
        modelName: embedderModelName,
      },
    })
    .addNode(proxyNode)
    .addNode(builtInIntentSubgraphNode)
    .addNode(greetingNode)
    .addNode(farewellNode)
    .addNode(intentMatchUnwrapNode)
    .addEdge(builtInIntentSubgraphNode, proxyNode)
    .addEdge(proxyNode, intentMatchUnwrapNode)
    .addEdge(intentMatchUnwrapNode, greetingNode, {
      conditionExpression: 'input.intent_name == "greeting"',
    })
    .addEdge(intentMatchUnwrapNode, farewellNode, {
      conditionExpression: 'input.intent_name == "farewell"',
    })
    .setStartNode(builtInIntentSubgraphNode)
    .setEndNodes([greetingNode, farewellNode])
    .build();

  const outputStream = graph.start(text);

  for await (const result of outputStream) {
    result.processResponse({
      MatchedIntents: (data) => {
        console.log('Matched intents:');
        data.intents.forEach((match, index) => {
          console.log(
            `  ${index + 1}. ${match.name} (score: ${match.score.toFixed(4)})`,
          );
        });
      },
      string: (data) => {
        console.log(`Custom node result: ${data}`);
      },
      default: (data) => {
        console.log('Unprocessed data:', data);
      },
    });
  }
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
  const embedderProvider = argv.embedderProvider || DEFAULT_EMBEDDER_PROVIDER;
  const llmModelName = argv.llmModelName || DEFAULT_LLM_MODEL_NAME;
  const llmProvider = argv.llmProvider || DEFAULT_LLM_PROVIDER;
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
