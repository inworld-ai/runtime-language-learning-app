import 'dotenv/config';

import { v4 } from 'uuid';

import { bindProcessHandlers, cleanup } from '../helpers/cli_helpers';
const minimist = require('minimist');

import { TextStreamIterator } from '@inworld/runtime/common';
import { GraphBuilder, NodeFactory } from '@inworld/runtime/graph';

const usage = `
Usage:
    yarn node-proxy <input-data> --inputType=<type>

Input Types:
    --inputType=llm_chat_request    Input as LLM chat request (JSON array)
    --inputType=text        Input as plain text string
    --inputType=custom        Input as custom JSON object

Examples:
    yarn node-proxy "Hello, how are you?" --inputType=text
    yarn node-proxy '[{"role": "user", "content": "Hello!"}]' --inputType=llm_chat_request
    yarn node-proxy '{"key": "value", "number": 42}' --inputType=custom

    # If you are on Windows, you need to escape the quotes in the JSON string.
    # For example (double check in node_proxy.ts to see the escape characters):
    yarn node-proxy '{\"key\": \"value\", \"number\": 42}' --inputType=custom
`;

run();

async function run() {
  const { inputData, inputType } = parseArgs();

  const proxyNodeId = 'proxy_node';
  const executor = new GraphBuilder('node_proxy_graph')
    .addNode(NodeFactory.createProxyNode({ id: proxyNodeId }))
    .setStartNode(proxyNodeId)
    .setEndNode(proxyNodeId)
    .getExecutor();

  // Convert input based on type
  const processedInput = await processInput(inputData, inputType);

  const outputStream = await executor.execute(processedInput, v4());

  await processOutput(outputStream, inputType);

  cleanup(executor, outputStream);
}

async function processInput(
  inputData: string,
  inputType: string,
): Promise<any> {
  switch (inputType) {
    case 'llm_chat_request':
      try {
        const messages = JSON.parse(inputData);
        if (!Array.isArray(messages)) {
          throw new Error('LLM chat request input must be a JSON array');
        }
        // Validate message format
        messages.forEach((msg: any, index: number) => {
          if (!msg.role || !msg.content) {
            throw new Error(
              `Message at index ${index} must have 'role' and 'content' properties`,
            );
          }
        });
        return messages;
      } catch (error) {
        throw new Error(`Invalid LLM chat request JSON: ${error.message}`);
      }

    case 'text':
      return inputData;

    case 'custom':
      try {
        return JSON.parse(inputData);
      } catch (error) {
        throw new Error(`Invalid custom JSON input: ${error.message}`);
      }

    default:
      throw new Error(`Unsupported input type: ${inputType}`);
  }
}

async function processOutput(outputStream: any, expectedInputType: string) {
  let result = '';
  let resultCount = 0;

  console.log(`Expected input type: ${expectedInputType}`);

  let chunk = await outputStream.next();
  const type = chunk.type;
  while (true) {
    resultCount++;
    if (chunk.data) {
      // Handle different output types
      switch (chunk.type) {
        case 'TEXT':
          result += chunk.data;
          console.log(`[${resultCount}] TEXT: ${chunk.data}`);
          break;

        case 'LLM_CHAT_REQUEST':
          console.log(
            `[${resultCount}] LLM_CHAT_REQUEST:`,
            JSON.stringify(chunk.data, null, 2),
          );
          result += JSON.stringify(chunk.data);
          break;

        default:
          // Handle TextStreamIterator and other streaming types
          if (chunk.data && typeof chunk.data.next === 'function') {
            const textStream = chunk.data as TextStreamIterator;
            let textChunk = await textStream.next();
            while (!textChunk.done) {
              result += textChunk.text;
              console.log(`[${resultCount}] STREAM: ${textChunk.text}`);
              textChunk = await textStream.next();
            }
          } else {
            console.log(
              `[${resultCount}] UNKNOWN TYPE (${chunk.type}):`,
              chunk.data,
            );
            result += String(chunk.data);
          }
      }
    }
    if (chunk.done) {
      break;
    }
    chunk = await outputStream.next();
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Result count: ${resultCount}`);
  console.log(`Final result: ${result}`);

  // Verify output type matches expected input type for proxy node
  verifyProxyBehavior(expectedInputType, type);
}

function verifyProxyBehavior(inputType: string, outputType: string) {
  const expectedMappings: Record<string, string[]> = {
    llm_chat_request: ['LLM_CHAT_REQUEST'],
    text: ['TEXT'],
    custom: ['CUSTOM'],
  };

  const expected = expectedMappings[inputType];
  if (expected && !expected.includes(outputType)) {
    throw new Error(
      `⚠️  Warning: Expected output type ${expected.join(' or ')} for input type '${inputType}', but got '${outputType}'`,
    );
  } else {
    console.log(
      `✅ Proxy behavior verified: '${inputType}' input → '${outputType}' output`,
    );
  }
}

function parseArgs(): {
  inputData: string;
  inputType: string;
} {
  const argv = minimist(process.argv.slice(2));

  if (argv.help) {
    console.log(usage);
    process.exit(0);
  }

  const inputData = argv._?.join(' ') || '';
  const inputType = argv.inputType || '';

  if (!inputData) {
    throw new Error(`You need to provide input data.\n${usage}`);
  }

  if (!inputType) {
    throw new Error(`You need to specify --inputType.\n${usage}`);
  }

  const supportedTypes = ['llm_chat_request', 'text', 'custom'];
  if (!supportedTypes.includes(inputType)) {
    throw new Error(
      `Unsupported input type '${inputType}'. Supported types: ${supportedTypes.join(', ')}\n${usage}`,
    );
  }

  return { inputData, inputType };
}
bindProcessHandlers();
