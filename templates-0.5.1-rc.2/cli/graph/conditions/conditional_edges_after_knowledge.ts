import 'dotenv/config';

import {
  CustomNode,
  GraphBuilder,
  GraphTypes,
  KnowledgeNode,
  ProcessContext,
} from '@inworld/runtime/graph';
import { v4 } from 'uuid';

import { DEFAULT_KNOWLEDGE_QUERY, KNOWLEDGE_RECORDS } from '../../constants';
import { bindProcessHandlers } from '../../helpers/cli_helpers';

const minimist = require('minimist');

class RecordsFoundNode extends CustomNode {
  process(
    _context: ProcessContext,
    inputs: GraphTypes.KnowledgeRecords,
  ): string {
    return `Records found: ${inputs.records.join(', ')}`;
  }
}

class NoRecordsNode extends CustomNode {
  process(
    _context: ProcessContext,
    _inputs: GraphTypes.KnowledgeRecords,
  ): string {
    return 'No records found';
  }
}

const usage = ` 
Usage:
    yarn conditional-edges-after-knowledge "How often are the Olympics held?"

Description:
    This example demonstrates how to create a graph with conditional edges.
    It will query a knowledge base and route the execution to different custom nodes based on the presence of records in the knowledge base.`;

run().catch(handleError);

async function run() {
  const { apiKey, query } = parseArgs();

  const knowledgeNode = new KnowledgeNode({
    id: 'knowledge-node',
    knowledgeId: `knowledge/${v4()}`,
    knowledgeRecords: KNOWLEDGE_RECORDS,
    maxCharsPerChunk: 1000,
    maxChunksPerDocument: 10,
  });

  const recordsFoundNode = new RecordsFoundNode();
  const noRecordsNode = new NoRecordsNode();

  // Build graph with conditional edges
  const graph = new GraphBuilder({
    id: 'conditional_edges_after_knowledge_graph',
    apiKey,
    enableRemoteConfig: false,
  })
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
    .build();

  const outputStream = graph.start(query);

  for await (const result of outputStream) {
    result.processResponse({
      KnowledgeRecords: (data) => {
        console.log(`Knowledge records found: ${data.records.length}`);
      },
      string: (data) => {
        console.log('Knowledge result:', data);
      },
      default: (data) => {
        console.log('Unprocessed data:', data);
      },
    });
  }
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
