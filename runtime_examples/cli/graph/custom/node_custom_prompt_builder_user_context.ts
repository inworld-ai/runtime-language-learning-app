import 'dotenv/config';

import { InworldError } from '@inworld/runtime/common';
import {
  CustomInputDataType,
  CustomOutputDataType,
  GraphBuilder,
  NodeFactory,
  registerCustomNodeType,
  UserContext,
} from '@inworld/runtime/graph';
import { v4 } from 'uuid';

import {
  DEFAULT_LLM_MODEL_NAME,
  DEFAULT_PROVIDER,
  TEXT_CONFIG_SDK,
} from '../../constants';
import {
  bindProcessHandlers,
  cleanup,
  parseArgs,
} from '../../helpers/cli_helpers';

const USER_ID = 'default_user';
const USER_AGE = '25';

const promptBuilderNodeType = registerCustomNodeType(
  'CustomPromptBuilderNode',
  [CustomInputDataType.TEXT],
  CustomOutputDataType.TEXT,
  (_context, input) => {
    if (typeof input === 'string') {
      const promptTemplate =
        'You are a helpful assistant. Please respond to the following request: {{user_input}}';
      const prompt = promptTemplate.replace('{{user_input}}', input);
      return prompt;
    }

    if (typeof input !== 'object' || input === null) {
      throw new InworldError('Expected JSON input or string');
    }

    try {
      const jsonInput = typeof input === 'string' ? JSON.parse(input) : input;
      const userInput = jsonInput.user_input || jsonInput.text;

      if (!userInput) {
        throw new InworldError('Expected user_input or text field in JSON');
      }

      const config = jsonInput._execution_config || {};
      const promptTemplate =
        config.prompt_template ||
        'You are a helpful assistant. Please respond to the following request: {{user_input}}';

      return promptTemplate.replace('{{user_input}}', userInput);
    } catch (_: unknown) {
      throw new InworldError('Invalid JSON input');
    }
  },
);

const usage = `
Usage:
    yarn node-custom-prompt-builder-user-context "What is the capital of France?" \n
    --help - Show this help message`;

run();

async function run() {
  const { apiKey, prompt } = parseArgs(usage);

  // Create nodes
  const promptBuilderNode = NodeFactory.createCustomNode(
    'CustomPromptBuilderNode',
    promptBuilderNodeType,
  );

  const completionNode = NodeFactory.createRemoteLLMCompletionNode({
    id: 'completion-node',
    llmConfig: {
      provider: DEFAULT_PROVIDER,
      modelName: DEFAULT_LLM_MODEL_NAME,
      apiKey,
      textGenerationConfig: TEXT_CONFIG_SDK,
      stream: false,
    },
  });

  // Build graph using DSL method chaining
  const executor = new GraphBuilder(
    'node_custom_prompt_builder_user_context_graph',
  )
    .addNode(promptBuilderNode)
    .addNode(completionNode)
    .addEdge(promptBuilderNode, completionNode)
    .setStartNode(promptBuilderNode)
    .setEndNode(completionNode)
    .getExecutor();

  const userContext = new UserContext(
    {
      user_id: USER_ID,
      age: USER_AGE,
    },
    USER_ID,
  );

  const outputStream = await executor.execute(prompt, v4(), userContext);
  const response = await outputStream.next();

  console.log(`Original prompt: ${prompt}`);
  console.log(`Generated response:`, response.data);

  cleanup(executor, outputStream);
}

bindProcessHandlers();
