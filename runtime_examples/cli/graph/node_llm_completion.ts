import 'dotenv/config';

import { TextStreamIterator } from '@inworld/runtime/common';
import { GraphBuilder, NodeFactory } from '@inworld/runtime/graph';
import { v4 } from 'uuid';

import { DEFAULT_LLM_MODEL_NAME, TEXT_CONFIG_SDK } from '../constants';
import {
  bindProcessHandlers,
  cleanup,
  parseArgs,
} from '../helpers/cli_helpers';

const usage = `
Usage:
    yarn node-llm-completion "Hello, how" \n
    --modelName=<model-name>[optional, default=${DEFAULT_LLM_MODEL_NAME}] \n
    --provider=<service-provider>[optional, default=inworld] \n
    --stream=<true/false>[optional, default=true]`;

run();

async function run() {
  const { prompt, modelName, provider, apiKey, stream } = parseArgs(usage);

  const llmCompletionNode = NodeFactory.createRemoteLLMCompletionNode({
    id: 'LLMCompletionNode',
    llmConfig: {
      provider,
      modelName,
      apiKey,
      textGenerationConfig: TEXT_CONFIG_SDK,
      stream,
    },
  });

  const executor = new GraphBuilder('node_llm_completion_graph')
    .addNode(llmCompletionNode)
    .setStartNode(llmCompletionNode)
    .setEndNode(llmCompletionNode)
    .getExecutor();

  const outputStream = await executor.execute(prompt, v4());

  const { data, type } = await outputStream.next();

  if (type === 'TEXT') {
    console.log(`Template: Result: ${data}`);
  } else if (stream) {
    let result = '';
    let resultCount = 0;
    const textStream: TextStreamIterator =
      data as unknown as TextStreamIterator;
    let chunk = await textStream.next();

    while (!chunk.done) {
      result += chunk.text;
      resultCount++;
      chunk = await textStream.next();
      console.log(`Template: Chunk: ${chunk.text}`);
    }

    console.log(`Template: Result count: ${resultCount}`);
    console.log(`Template: Result: ${result}`);
  } else {
    console.log(`Template: Result: ${data}`);
  }

  cleanup(executor, outputStream);
}

bindProcessHandlers();
