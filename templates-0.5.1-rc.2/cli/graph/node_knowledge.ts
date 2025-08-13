import 'dotenv/config';

import { GraphBuilder, KnowledgeNode } from '@inworld/runtime/graph';

import { DEFAULT_KNOWLEDGE_QUERY, KNOWLEDGE_RECORDS } from '../constants';
import { bindProcessHandlers } from '../helpers/cli_helpers';

const minimist = require('minimist');
const usage = `
Usage:
    yarn node-knowledge "How often are the Olympics held?"

Note: INWORLD_API_KEY environment variable must be set`;

run();

async function run() {
  const { apiKey, query } = parseArgs();

  const knowledgeNode = new KnowledgeNode({
    id: 'knowledge_node',
    knowledgeId: `knowledge/48f6c401-c244-4146-ba53-c684caa697d4`,
    knowledgeRecords: KNOWLEDGE_RECORDS,
    maxCharsPerChunk: 1000,
    maxChunksPerDocument: 10,
  });

  const graph = new GraphBuilder({
    id: 'node_knowledge_graph',
    apiKey,
    enableRemoteConfig: false,
  })
    .addNode(knowledgeNode)
    .setStartNode(knowledgeNode)
    .setEndNode(knowledgeNode)
    .build();

  const outputStream = graph.start(query);

  console.log('Initial knowledge:');
  KNOWLEDGE_RECORDS.forEach((record: string, index: number) => {
    console.log(`[${index}]: ${record}`);
  });

  for await (const result of outputStream) {
    result.processResponse({
      KnowledgeRecords: ({ records }) => {
        console.log('Retrieved knowledge:');
        records.forEach((record: string, index: number) => {
          console.log(`[${index}]: ${record}`);
        });
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

bindProcessHandlers();
