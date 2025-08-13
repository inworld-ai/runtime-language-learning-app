import 'dotenv/config';

import {
  GraphBuilder,
  GraphTypes,
  RemoteLLMCompletionNode,
} from '@inworld/runtime/graph';

import { DEFAULT_LLM_MODEL_NAME, DEFAULT_LLM_PROVIDER } from '../constants';
import { bindProcessHandlers, parseArgs } from '../helpers/cli_helpers';

const usage = `
Usage:
    yarn node-llm-completion "Hello, how" \n
    --modelName=<model-name>[optional, default=${DEFAULT_LLM_MODEL_NAME}] \n
    --provider=<service-provider>[optional, default=${DEFAULT_LLM_PROVIDER}] \n
    --stream=<true/false>[optional, default=true]`;

run();

async function run() {
  const { prompt, modelName, provider, apiKey, stream } = parseArgs(usage);

  const llmCompletionNode = new RemoteLLMCompletionNode({
    provider,
    modelName,
    stream,
    textGenerationConfig: {
      maxNewTokens: 100,
    },
  });

  const graph = new GraphBuilder({
    id: 'node_llm_completion_graph',
    apiKey,
    enableRemoteConfig: false,
  })
    .addNode(llmCompletionNode)
    .setStartNode(llmCompletionNode)
    .setEndNode(llmCompletionNode)
    .build();

  const outputStream = graph.start(prompt);

  for await (const result of outputStream) {
    await result.processResponse({
      string: (text: string) => {
        console.log(`  Template: Result: ${text}`);
      },
      TextStream: async (textStream: GraphTypes.TextStream) => {
        let resultCount = 0;
        console.log('📡 LLM Completion Response Stream:');
        let result = '';
        for await (const chunk of textStream) {
          if (chunk.text) {
            resultCount++;
            result += chunk.text;
            process.stdout.write(chunk.text);
          }
        }
        console.log('\n');
        console.log(`  Result count: ${resultCount}`);
        console.log(`  Result:\n${result}`);
      },
      default: (data: any) => {
        console.log('Unprocessed response:', data);
      },
    });
  }
}

bindProcessHandlers();
