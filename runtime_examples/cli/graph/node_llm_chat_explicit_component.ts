import 'dotenv/config';

import { TextStreamIterator } from '@inworld/runtime/common';
import {
  ComponentFactory,
  GraphBuilder,
  NodeFactory,
} from '@inworld/runtime/graph';
import { v4 } from 'uuid';

import { DEFAULT_LLM_MODEL_NAME, TEXT_CONFIG_SDK } from '../constants';
import {
  bindProcessHandlers,
  cleanup,
  parseArgs,
} from '../helpers/cli_helpers';

const usage = `
Usage:
    yarn node-llm-chat-explicit-component "Hello, how are you?" \n
    --modelName=<model-name>[optional, default=${DEFAULT_LLM_MODEL_NAME}] \n
    --provider=<service-provider>[optional, default=inworld] \n
    --stream=<true/false>[optional, default=true]`;

run();

async function run() {
  const { prompt, modelName, provider, apiKey, stream } = parseArgs(usage);

  const llmComponent = ComponentFactory.createRemoteLLMComponent({
    id: 'test_llm_component',
    provider,
    modelName,
    apiKey,
    defaultConfig: TEXT_CONFIG_SDK,
  });

  console.log(typeof stream);
  const llmNode = NodeFactory.createRemoteLLMChatNode({
    id: v4() + '_llm_node',
    executionConfig: {
      llmComponentId: llmComponent.id,
      textGenerationConfig: TEXT_CONFIG_SDK,
      stream,
    },
  });

  const executor = new GraphBuilder('node_llm_chat_explicit_component_graph')
    .addComponent(llmComponent)
    .addNode(llmNode)
    .setStartNode(llmNode)
    .setEndNode(llmNode)
    .getExecutor();

  const outputStream = await executor.execute(
    [
      {
        role: 'user',
        content: prompt,
      },
    ],
    v4(),
  );

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
    }

    console.log(`Template: Result count: ${resultCount}`);
    console.log(`Template: Result: ${result}`);
  } else {
    console.log(`Template: Result: ${data}`);
  }

  cleanup(executor, outputStream);
}

bindProcessHandlers();
