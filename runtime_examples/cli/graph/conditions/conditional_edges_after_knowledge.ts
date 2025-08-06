import 'dotenv/config';

import {
  ComponentFactory,
  CustomInputDataType,
  CustomOutputDataType,
  GraphBuilder,
  NodeFactory,
  ProcessContext,
  registerCustomNodeType,
} from '@inworld/runtime/graph';
import { v4 } from 'uuid';

import { DEFAULT_KNOWLEDGE_QUERY, KNOWLEDGE_RECORDS } from '../../constants';
import { bindProcessHandlers, cleanup } from '../../helpers/cli_helpers';

const minimist = require('minimist');

const recordsFoundNodeType = registerCustomNodeType(
  'RecordsFoundNode',
  [CustomInputDataType.KNOWLEDGE_RECORDS],
  CustomOutputDataType.TEXT,
  (_context: ProcessContext, inputs: string[]) => {
    return `Records found: ${inputs.join(', ')}`;
  },
);

const noRecordsNodeType = registerCustomNodeType(
  'NoRecordsNode',
  [CustomInputDataType.KNOWLEDGE_RECORDS],
  CustomOutputDataType.TEXT,
  (_context: ProcessContext, _inputs: any) => {
    return 'No records found';
  },
);

const usage = `
Usage:
    yarn conditional-edges-after-knowledge "How often are the Olympics held?"

Description:
    This example demonstrates how to create a graph with conditional edges.
    It will query a knowledge base and route the execution to different custom nodes based on the presence of records in the knowledge base.`;

run().catch(handleError);

async function run() {
  const { apiKey, query } = parseArgs();

  // Create knowledge component
  const knowledgeComponent = ComponentFactory.createRemoteKnowledgeComponent({
    id: 'knowledge_component_id',
    apiKey,
    maxCharsPerChunk: 1000,
    maxChunksPerDocument: 10,
  });

  const knowledgeNode = NodeFactory.createKnowledgeNode({
    id: 'knowledge-node',
    knowledgeId: `knowledge/${v4()}`,
    knowledgeRecords: KNOWLEDGE_RECORDS,
    knowledgeComponentId: knowledgeComponent.id,
  });

  const recordsFoundNode = NodeFactory.createCustomNode(
    'records-found-node',
    recordsFoundNodeType,
  );

  const noRecordsNode = NodeFactory.createCustomNode(
    'no-records-node',
    noRecordsNodeType,
  );

  // Build graph with conditional edges
  const executor = new GraphBuilder('conditional_edges_after_knowledge_graph')
    .addComponent(knowledgeComponent)
    .addNode(knowledgeNode)
    .addNode(recordsFoundNode)
    .addNode(noRecordsNode)
    .addEdge(knowledgeNode, recordsFoundNode, {
      conditionExpression: 'size(input) > 0',
    })
    .addEdge(knowledgeNode, noRecordsNode, {
      conditionExpression: 'size(input) == 0',
    })
    .setStartNode(knowledgeNode)
    .setEndNodes([recordsFoundNode, noRecordsNode])
    .getExecutor();

  const outputStream = await executor.execute(query, v4());

  const result = (await outputStream.next()).data as string;

  console.log('Knowledge result:', result);

  cleanup(executor, outputStream);
}

// Parse command line arguments
function parseArgs(): {
  apiKey: string;
  query: string;
} {
  const argv = minimist(process.argv.slice(2));

  if (argv.help) {
    console.log(usage);
    process.exit(0);
  }

  const query = argv._?.join(' ') || DEFAULT_KNOWLEDGE_QUERY;
  const apiKey = process.env.INWORLD_API_KEY || '';

  if (!apiKey) {
    throw new Error(
      `You need to set INWORLD_API_KEY environment variable.\n${usage}`,
    );
  }

  return { apiKey, query };
}

// Error handler
function handleError(err: Error) {
  console.error('Error: ', err.message);
  process.exit(1);
}

bindProcessHandlers();
