import 'dotenv/config';

import {
  CustomNode,
  GraphBuilder,
  GraphTypes,
  ProcessContext,
  RemoteLLMChatNode,
} from '@inworld/runtime/graph';

import { bindProcessHandlers, parseArgs } from '../../helpers/cli_helpers';

class GreaterThan50Node extends CustomNode {
  process(_context: ProcessContext, input: GraphTypes.Content): string {
    const result = Number(input.content);
    return `Generated number is greater than 50: ${result}`;
  }
}

class LessEqual50Node extends CustomNode {
  process(_context: ProcessContext, input: GraphTypes.Content): string {
    const result = Number(input.content);
    return `Generated number is less or equal to 50: ${result}`;
  }
}

const prompt = `
Generate a random number between 1 and 100.

# OUTPUT FORMAT
Output *ONLY* the single numeric. Do *NOT* include *ANY* other text, formatting, spaces, or special tokens (like <|eot>). The output must be exactly one number and nothing else.
`;

const usage = `
Usage:
    yarn custom-conditional-edges-after-llm
Description:
    This example demonstrates how to create a graph with custom conditional edges.
    It will generate a random number between 1 and 100.
    If the number is greater than 50, it will go to the custom node 1.
    If the number is less or equal to 50, it will go to the custom node 2.
`;

run();

async function run() {
  const { modelName, provider, apiKey } = parseArgs(usage, {
    skipPrompt: true,
  });

  const llmNode = new RemoteLLMChatNode({
    id: 'llm-node',
    provider,
    modelName,
    reportToClient: true,
  });

  const greaterThan50Node = new GreaterThan50Node();

  const lessEqual50Node = new LessEqual50Node();

  // Build graph with conditional edges
  const graph = new GraphBuilder({
    id: 'custom_conditional_edges_after_llm_graph',
    apiKey,
    enableRemoteConfig: false,
  })
    .addNode(llmNode)
    .addNode(greaterThan50Node)
    .addNode(lessEqual50Node)
    .addEdge(llmNode, greaterThan50Node, {
      condition: (_processContext, input: GraphTypes.Content) => {
        return Number(input.content) > 50;
      },
    })
    .addEdge(llmNode, lessEqual50Node, {
      condition: (_processContext, input: GraphTypes.Content) => {
        return Number(input.content) <= 50;
      },
    })
    .setStartNode(llmNode)
    .setEndNodes([greaterThan50Node, lessEqual50Node])
    .build();

  const outputStream = graph.start(
    new GraphTypes.LLMChatRequest({
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  );

  const llmResult = await outputStream.next();
  console.log('LLM result:', llmResult);

  const customNodeResult = await outputStream.next();
  console.log(`Custom node result:`, customNodeResult);
}

bindProcessHandlers();
