import 'dotenv/config';

import { InworldError } from '@inworld/runtime/common';
import { History } from '@inworld/runtime/core';
import { KnowledgeCreationConfig } from '@inworld/runtime/primitives/knowledge';
import { KnowledgeFactory } from '@inworld/runtime/primitives/knowledge';

import {
  DEFAULT_KNOWLEDGE_QUERY,
  KNOWLEDGE_COMPILE_CONFIG_SDK,
  KNOWLEDGE_RECORDS,
} from '../../constants';

const minimist = require('minimist');

const usage = `
Usage:
    yarn basic-remote-knowledge "How often are the Olympics held?"
    
Note: INWORLD_API_KEY environment variable must be set`;

run().catch(handleError);

async function run() {
  const { apiKey, query } = parseArgs();

  console.log('Remote Knowledge Example');
  console.log('------------------------');

  const config: KnowledgeCreationConfig = {
    type: 'remote',
    config: {
      knowledgeCompileConfig: KNOWLEDGE_COMPILE_CONFIG_SDK,
      apiKey,
    },
  };

  let knowledge = null;

  try {
    console.log('Creating remote knowledge instance...');
    knowledge = await KnowledgeFactory.create(config);

    // Use the knowledge
    await runKnowledgeOperations(knowledge, query);
  } finally {
    // Clean up resources
    if (knowledge) knowledge.destroy();
  }

  console.log('Example completed successfully.');
}

// Function to handle knowledge operations
async function runKnowledgeOperations(knowledge: any, query: string) {
  // ID for our knowledge collection
  // NOTE: Knowledge IDs must start with 'knowledge/' prefix
  const knowledgeId = 'knowledge/my-test-collection';

  try {
    // Compile knowledge
    console.log('Compiling knowledge...');
    const compiledRecords = await knowledge.compileKnowledge(
      knowledgeId,
      KNOWLEDGE_RECORDS,
    );
    console.log(`Successfully compiled ${compiledRecords.length} records.`);

    const history = new History([
      {
        name: 'User',
        utterance: query,
      },
    ]);

    // Retrieve knowledge
    console.log('Retrieving knowledge...');
    const retrievedKnowledge = await knowledge.getKnowledge({
      ids: [knowledgeId],
      eventHistory: history,
    });

    // Display results
    console.log('Initial knowledge:');
    KNOWLEDGE_RECORDS.forEach((record: string, index: number) => {
      console.log(`[${index}]: ${record}`);
    });
    console.log('Retrieved knowledge:');
    retrievedKnowledge.forEach((record: string, index: number) => {
      console.log(`[${index}]: ${record}`);
    });

    // Clean up resources
    history.destroy();

    // Clean up
    console.log('Removing knowledge...');
    await knowledge.removeKnowledge(knowledgeId);
    console.log('Knowledge removed successfully.');
  } catch (error) {
    // Remove knowledge even if an error occurred during operations
    try {
      await knowledge.removeKnowledge(knowledgeId);
      console.log('Knowledge removed during cleanup.');
    } catch (_cleanupError) {
      console.error(
        'Failed to remove knowledge during cleanup:',
        _cleanupError,
      );
    }

    // Re-throw the original error
    throw error;
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

  const apiKey = process.env.INWORLD_API_KEY || DEFAULT_KNOWLEDGE_QUERY;
  const query = argv._?.join(' ') || DEFAULT_KNOWLEDGE_QUERY;

  if (!apiKey) {
    throw new Error(
      `You need to set INWORLD_API_KEY environment variable.\n${usage}`,
    );
  }

  return { apiKey, query };
}

// Error handler
function handleError(err: Error) {
  if (err instanceof InworldError) {
    console.error('Inworld Error: ', {
      message: err.message,
      context: (err as any).context,
    });
  } else {
    console.error(err.message);
  }
  process.exit(1);
}

// Handle process events for clean shutdown
function done() {
  process.exit(0);
}

process.on('SIGINT', done);
process.on('SIGTERM', done);
process.on('SIGUSR2', done);
process.on('unhandledRejection', handleError);
