import 'dotenv/config';

import {
  GraphBuilder,
  GraphTypes,
  LLMChatRequestBuilderNode,
  RemoteLLMChatNode,
  RequestBuilderToolChoice,
} from '@inworld/runtime/graph';
const minimist = require('minimist');
import { stdout } from 'process';

import { bindProcessHandlers } from '../helpers/cli_helpers';

const DEFAULT_LLM_MODEL_NAME = 'gpt-4o';

const tools = [
  {
    name: 'calculator',
    description: 'Evaluate a mathematical expression',
    properties: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description:
            'The mathematical expression to evaluate (e.g., "2 + 2", "10 * 5")',
        },
      },
      required: ['expression'],
    },
  },
  {
    name: 'get_weather',
    description: 'Get the current weather in a given location',
    properties: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'The city and state, e.g. San Francisco, CA',
        },
      },
      required: ['location'],
    },
  },
];

const usage = `
Usage:
    yarn node-llm-chat-advanced '{"user_input": "What is 25 * 4 and what is the weather like in New York?"}'
    --modelName=<model-name>[optional, default=${DEFAULT_LLM_MODEL_NAME}] 
    --provider=<service-provider>[optional, default=openai]
    --toolChoice[optional, tool choice strategy: auto/required/none/function_name]
    --stream[optional, enable streaming responses]
    --imageUrl=<image-url>[optional, include an image in the message for multimodal input]

Examples:
    # Basic request with tools
    yarn node-llm-chat-advanced '{"user_input": "What is 15 + 27?"}' --toolChoice="auto"
    
    # Multiple tools with streaming
    yarn node-llm-chat-advanced '{"user_input": "Calculate 100 * 5 and search for information about Node.js"}' --toolChoice="required" --stream
    
    # Specific tool choice
    yarn node-llm-chat-advanced '{"user_input": "What is 2 + 2?"}' --toolChoice="calculator"

    # Multimodal request
    yarn node-llm-chat-advanced '{"user_input": "what is in this image?"}' --imageUrl="https://cms.inspirato.com/ImageGen.ashx?image=%2fmedia%2f5682444%2fLondon_Dest_16531610X.jpg"
  
    # If you are on Windows, you need to escape the quotes in the JSON string.
    # For example (double check in node_llm_chat_advanced.ts to see the escape characters):
    yarn node-llm-chat-advanced '{\"user_input\": \"What is 25 * 4 and what is the weather like in New York?\"}'
`;

run();

function getRequestBuilderToolChoice(
  toolChoice: string,
): RequestBuilderToolChoice {
  switch (toolChoice) {
    case 'auto':
    case 'required':
    case 'none':
      return {
        type: 'string',
        value: toolChoice,
      };
    default:
      return {
        type: 'function',
        function: {
          type: 'function',
          name: toolChoice,
        },
      };
  }
}

async function run() {
  const {
    jsonData,
    modelName,
    provider,
    apiKey,
    toolChoice,
    stream,
    imageUrl,
  } = parseArgs();

  console.log('imageUrl', imageUrl);

  const userMessage: any = {
    role: 'user',
  };

  if (imageUrl) {
    userMessage.content_items = [
      {
        type: 'template',
        template: '{{user_input}}',
      },
      {
        type: 'image',
        url: imageUrl,
        detail: 'high',
      },
    ];
  } else {
    userMessage.content = {
      type: 'template',
      template: '{{user_input}}',
    };
  }

  const llmRequestBuilderNode = new LLMChatRequestBuilderNode({
    id: 'llm_request_builder_node',
    tools: tools,
    toolChoice: toolChoice
      ? getRequestBuilderToolChoice(toolChoice)
      : undefined,
    responseFormat: 'json',
    messages: [
      {
        role: 'system',
        content: {
          type: 'template',
          template:
            'You are a helpful assistant. When appropriate, use the available tools to provide accurate and helpful responses in json format.',
        },
      },
      userMessage,
    ],
  });

  const llmChatNode = new RemoteLLMChatNode({
    id: 'llm_chat_node',
    provider: provider,
    modelName: modelName,
    stream: stream,
    textGenerationConfig: {
      maxNewTokens: 200,
    },
    reportToClient: true,
  });

  const builder = new GraphBuilder({
    id: 'node_llm_chat_advanced_graph',
    apiKey,
    enableRemoteConfig: false,
  })
    .addNode(llmRequestBuilderNode)
    .addNode(llmChatNode)
    .addEdge(llmRequestBuilderNode, llmChatNode)
    .setStartNode(llmRequestBuilderNode)
    .setEndNode(llmChatNode);

  const graph = builder.build();
  const outputStream = graph.start(jsonData);

  for await (const result of outputStream) {
    await result.processResponse({
      Content: (response: any) => {
        console.log('📥 LLM Chat Response:');
        console.log('  Content:', response.content);
        if (response.toolCalls && response.toolCalls.length > 0) {
          console.log('  Tool Calls:');
          response.toolCalls.forEach((toolCall: any, index: number) => {
            console.log(`    ${index + 1}. ${toolCall.name}(${toolCall.args})`);
            console.log(`       ID: ${toolCall.id}`);
          });
        }
      },
      ContentStream: async (contentStream: GraphTypes.ContentStream) => {
        console.log('📡 LLM Chat Response Stream:');
        let streamContent = '';
        const toolCalls: { [id: string]: any } = {};
        let chunkCount = 0;
        for await (const chunk of contentStream) {
          chunkCount++;
          if (chunk.text) {
            stdout.write(chunk.text);
            streamContent += chunk.text;
          }
          if (chunk.toolCalls && chunk.toolCalls.length > 0) {
            for (const toolCall of chunk.toolCalls) {
              if (toolCalls[toolCall.id]) {
                toolCalls[toolCall.id].args += toolCall.args;
              } else {
                toolCalls[toolCall.id] = { ...toolCall };
              }
            }
          }
        }
        console.log(`\n\n  Total chunks: ${chunkCount}`);
        console.log(
          `  Final content length: ${streamContent.length} characters`,
        );
        console.log(`\n\n  Final response: ${streamContent}`);
        const finalToolCalls = Object.values(toolCalls);
        if (finalToolCalls.length > 0) {
          console.log('  Tool Calls from Stream:');
          finalToolCalls.forEach((toolCall: any, index: number) => {
            console.log(`    ${index + 1}. ${toolCall.name}(${toolCall.args})`);
            console.log(`       ID: ${toolCall.id}`);
          });
        }
      },
    });
  }
}

function parseArgs(): {
  jsonData: { user_input: string; image_url?: string };
  modelName: string;
  provider: string;
  apiKey: string;
  toolChoice: string;
  stream: boolean;
  imageUrl?: string;
} {
  const argv = minimist(process.argv.slice(2));

  if (argv.help) {
    console.log(usage);
    process.exit(0);
  }

  const jsonString = argv._?.join(' ') || '';
  const modelName = argv.modelName || DEFAULT_LLM_MODEL_NAME;
  const provider = argv.provider || 'openai';
  const apiKey = process.env.INWORLD_API_KEY || '';
  const toolChoice = argv.toolChoice || '';
  const stream = argv.stream !== 'false';
  const imageUrl = argv.imageUrl;

  if (!jsonString) {
    throw new Error(
      `You need to provide a JSON string with user data.\n${usage}`,
    );
  }

  if (!apiKey) {
    throw new Error(
      `You need to set INWORLD_API_KEY environment variable.\n${usage}`,
    );
  }

  let jsonData;
  try {
    jsonData = JSON.parse(jsonString);
  } catch (error) {
    throw new Error(`Invalid JSON string provided: ${error.message}\n${usage}`);
  }

  if (!jsonData.user_input) {
    throw new Error(`JSON data must include 'user_input' field.\n${usage}`);
  }

  return {
    jsonData: {
      user_input: jsonData.user_input,
      ...(imageUrl && { image_url: imageUrl }),
    },
    modelName,
    provider,
    apiKey,
    toolChoice,
    stream,
    imageUrl,
  };
}

bindProcessHandlers();
