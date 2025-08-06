import 'dotenv/config';

import {
  ComponentFactory,
  GraphBuilder,
  NodeFactory,
} from '@inworld/runtime/graph';
import { v4 } from 'uuid';

import { DEFAULT_KNOWLEDGE_QUERY, KNOWLEDGE_RECORDS } from '../constants';
import { bindProcessHandlers, cleanup } from '../helpers/cli_helpers';

const minimist = require('minimist');
const usage = `
Usage:
    yarn node-knowledge "How often are the Olympics held?"

Note: INWORLD_API_KEY environment variable must be set`;

run();

async function run() {
  const { apiKey, query } = parseArgs();

  const knowledgeComponent = ComponentFactory.createRemoteKnowledgeComponent({
    id: 'knowledge_component',
    apiKey,
    maxCharsPerChunk: 1000,
    maxChunksPerDocument: 10,
  });

  const knowledgeNode = NodeFactory.createKnowledgeNode({
    id: 'knowledge_node',
    knowledgeId: `knowledge/${v4()}`,
    knowledgeRecords: KNOWLEDGE_RECORDS,
    knowledgeComponentId: knowledgeComponent.id,
  });

  const executor = new GraphBuilder('node_knowledge_graph')
    .addComponent(knowledgeComponent)
    .addNode(knowledgeNode)
    .setStartNode(knowledgeNode)
    .setEndNode(knowledgeNode)
    .getExecutor();

  const outputStream = await executor.execute(query, v4());

  const result = (await outputStream.next()).data as string[];

  console.log('Initial knowledge:');
  KNOWLEDGE_RECORDS.forEach((record: string, index: number) => {
    console.log(`[${index}]: ${record}`);
  });

  console.log('Retrieved knowledge:');
  result.forEach((record: string, index: number) => {
    console.log(`[${index}]: ${record}`);
  });

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

bindProcessHandlers();
