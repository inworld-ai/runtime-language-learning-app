import 'dotenv/config';

import { InworldError } from '@inworld/runtime/common';
import {
  CustomNode,
  GraphBuilder,
  ProcessContext,
  RemoteLLMCompletionNode,
  UserContext,
} from '@inworld/runtime/graph';

import { bindProcessHandlers, parseArgs } from '../../helpers/cli_helpers';

const USER_ID = 'default_user';
const USER_AGE = '25';

class CustomPromptBuilderNode extends CustomNode {
  process(_context: ProcessContext, input: unknown): string {
    if (typeof input === 'string') {
      const promptTemplate =
        'You are a helpful assistant. Please respond to the following request: {{user_input}}';
      return promptTemplate.replace('{{user_input}}', input);
    }

    if (typeof input !== 'object' || input === null) {
      throw new InworldError('Expected JSON input or string');
    }

    try {
      const jsonInput = input as Record<string, any>;
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
  }
}

const usage = `
Usage:
    yarn node-custom-prompt-builder-user-context "What is the capital of France?" \n
    --help - Show this help message`;

run();

async function run() {
  const { apiKey, prompt } = parseArgs(usage);

  // Create nodes
  const promptBuilderNode = new CustomPromptBuilderNode();

  const completionNode = new RemoteLLMCompletionNode({
    textGenerationConfig: {
      maxNewTokens: 100,
    },
  });

  // Build graph using DSL method chaining
  const graph = new GraphBuilder({
    id: 'node_custom_prompt_builder_user_context_graph',
    apiKey,
    enableRemoteConfig: false,
  })
    .addNode(promptBuilderNode)
    .addNode(completionNode)
    .addEdge(promptBuilderNode, completionNode)
    .setStartNode(promptBuilderNode)
    .setEndNode(completionNode)
    .build();

  const userContext = new UserContext(
    {
      user_id: USER_ID,
      age: USER_AGE,
    },
    USER_ID,
  );

  const outputStream = graph.start(prompt, userContext);
  const response = await outputStream.next();

  response.processResponse({
    string: (data) => {
      console.log(`Original prompt: ${prompt}`);
      console.log(`Generated response:`, data);
    },
    default: (data) => console.log('Unprocessed data:', data),
  });
}

bindProcessHandlers();
