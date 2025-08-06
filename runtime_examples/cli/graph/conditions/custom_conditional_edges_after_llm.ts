import 'dotenv/config';

import {
  CustomInputDataType,
  CustomOutputDataType,
  GraphBuilder,
  NodeFactory,
  ProcessContext,
  registerCustomEdgeCondition,
  registerCustomNodeType,
} from '@inworld/runtime/graph';
import { v4 } from 'uuid';

import {
  bindProcessHandlers,
  cleanup,
  parseArgs,
} from '../../helpers/cli_helpers';

const greaterThan50ConditionRef = registerCustomEdgeCondition(
  'greater-than-50-condition',
  CustomInputDataType.CONTENT,
  async (input) => {
    return Number(input.content) > 50;
  },
);

const lessEqual50ConditionRef = registerCustomEdgeCondition(
  'less-equal-50-condition',
  CustomInputDataType.CONTENT,
  async (input) => {
    return Number(input.content) <= 50;
  },
);

// Register custom node types
const greaterThan50NodeType = registerCustomNodeType(
  'GreaterThan50Node',
  [CustomInputDataType.CONTENT],
  CustomOutputDataType.TEXT,
  (_context, input) => {
    const result = Number(input.content);
    return `Generated number is greater than 50: ${result}`;
  },
);

const lessEqual50NodeType = registerCustomNodeType(
  'LessEqual50Node',
  [CustomInputDataType.CONTENT],
  CustomOutputDataType.TEXT,
  (_context: ProcessContext, input) => {
    const result = Number(input.content);
    return `Generated number is less or equal to 50: ${result}`;
  },
);

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

  const llmNode = NodeFactory.createRemoteLLMChatNode({
    id: 'llm-node',
    llmConfig: {
      provider,
      modelName,
      apiKey,
      reportToClient: true,
    },
  });

  const greaterThan50Node = NodeFactory.createCustomNode(
    'greater-than-50-node',
    greaterThan50NodeType,
  );

  const lessEqual50Node = NodeFactory.createCustomNode(
    'less-equal-50-node',
    lessEqual50NodeType,
  );

  // Build graph with conditional edges
  const executor = new GraphBuilder('custom_conditional_edges_after_llm_graph')
    .addComponent({
      id: 'greater-than-50-condition',
      type: 'greater-than-50-condition',
    })
    .addComponent({
      id: 'less-equal-50-condition',
      type: 'less-equal-50-condition',
    })
    .addNode(llmNode)
    .addNode(greaterThan50Node)
    .addNode(lessEqual50Node)
    .addEdge(llmNode, greaterThan50Node, {
      conditionRef: greaterThan50ConditionRef,
    })
    .addEdge(llmNode, lessEqual50Node, {
      conditionRef: lessEqual50ConditionRef,
    })
    .setStartNode(llmNode)
    .setEndNodes([greaterThan50Node, lessEqual50Node])
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

  const llmResult = await outputStream.next();
  console.log('LLM result:', llmResult);

  const customNodeResult = await outputStream.next();
  console.log(`Custom node result:`, customNodeResult);

  cleanup(executor, outputStream);
}

bindProcessHandlers();
