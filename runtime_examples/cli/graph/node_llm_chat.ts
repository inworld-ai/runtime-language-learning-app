import 'dotenv/config';

import {
  ContentInterface,
  ContentStreamIterator,
  LLMChatRequestInterface,
} from '@inworld/runtime/common';
import { GraphBuilder, NodeFactory } from '@inworld/runtime/graph';
import { v4 } from 'uuid';

import { bindProcessHandlers, cleanup } from '../helpers/cli_helpers';
const minimist = require('minimist');
import { DEFAULT_LLM_MODEL_NAME, TEXT_CONFIG, TOOLS } from '../constants';

const usage = `
Usage:
    yarn node-llm-chat "Tell me the weather in Vancouver and evaluate the expression 2 + 2" \n
    --modelName=<model-name>[optional, default=${DEFAULT_LLM_MODEL_NAME}] \n
    --provider=<service-provider>[optional, default=inworld] \n
    --stream=<true|false>[optional, default=true, enable/disable streaming] \n
    --tools[optional, enable tool calling demonstration] \n
    --toolChoice=<auto|required|none|function_name>[optional, tool choice strategy when --tools is used] \n
    --imageUrl=<image-url>[optional, include an image in the message for multimodal input]
    --responseFormat=<text|json>[optional, response format for the LLM]
    --toolCallHistory=<true|false>[optional, enable/disable tool call history]

Examples:
    # Basic request
    yarn node-llm-chat "Tell me the weather in Vancouver"

    # Basic request with tools
    yarn node-llm-chat "What is 15 + 27?" --modelName="gpt-4o-mini" --provider="openai" --tools --toolChoice="auto"
    
    # Specific tool choice.
    yarn node-llm-chat "What is the weather in Vancouver?" --modelName="gpt-4o-mini" --provider="openai" --tools --toolChoice="get_weather"
    
    # Multimodal request with image
    yarn node-llm-chat "What do you see in this image?" --modelName="gpt-4o" --provider="openai" --imageUrl="https://upload.wikimedia.org/wikipedia/en/a/a9/Example.jpg"

    # Request with response format
    yarn node-llm-chat "Generate a user profile for a software engineer. Include name, profession, experience_years, skills array, and location. return in json format" --modelName="gpt-4o-mini" --provider="openai" --responseFormat="json"
    `;

run();

async function run() {
  const {
    prompt,
    modelName,
    provider,
    apiKey,
    tools,
    stream,
    toolChoice,
    imageUrl,
    responseFormat,
    toolCallHistory,
  } = parseArgs();

  const llmNode = NodeFactory.createRemoteLLMChatNode({
    id: v4() + '_llm_node',
    llmConfig: {
      provider,
      modelName,
      apiKey,
      stream,
      textGenerationConfig: TEXT_CONFIG,
    },
  });

  const executor = new GraphBuilder('node_llm_chat_graph')
    .addNode(llmNode)
    .setStartNode(llmNode)
    .setEndNode(llmNode)
    .getExecutor();

  let graphInput;

  if (tools) {
    graphInput = createMessagesWithTools(
      prompt,
      toolChoice,
      imageUrl,
      toolCallHistory,
    );
  } else {
    graphInput = createMessages(prompt, imageUrl, toolCallHistory);
  }

  if (responseFormat) {
    graphInput.responseFormat = responseFormat;
  }

  console.log('Graph Input:', graphInput);

  const outputStream = await executor.execute(
    graphInput as LLMChatRequestInterface,
    v4(),
  );

  let result = await outputStream.next();
  while (true) {
    switch (result.type) {
      case 'CONTENT':
        const response = result.data as ContentInterface;
        console.log('📥 LLM Chat Response:');
        console.log('  Content:', response.content);
        if (response.toolCalls && response.toolCalls.length > 0) {
          console.log('  Tool Calls:');
          response.toolCalls.forEach((toolCall, index) => {
            console.log(`    ${index + 1}. ${toolCall.name}(${toolCall.args})`);
            console.log(`       ID: ${toolCall.id}`);
          });
        }
        break;

      case 'CONTENT_STREAM':
        const streamIterator = result.data as ContentStreamIterator;
        console.log('📡 LLM Chat Response Stream:');

        let streamContent = '';
        const toolCalls: { [id: string]: any } = {};
        let chunkCount = 0;

        while (true) {
          const chunk = await streamIterator.next();
          if (chunk.done) {
            break;
          }

          chunkCount++;
          if (chunk.text) {
            streamContent += chunk.text;
            process.stdout.write(chunk.text);
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

        console.log(`\nTotal chunks: ${chunkCount}`);
        console.log(`Final content length: ${streamContent.length} characters`);

        const finalToolCalls = Object.values(toolCalls);
        if (finalToolCalls.length > 0) {
          console.log('Tool Calls from Stream:');
          finalToolCalls.forEach((toolCall, index) => {
            console.log(`  ${index + 1}. ${toolCall.name}(${toolCall.args})`);
            console.log(`     ID: ${toolCall.id}`);
          });
        }
        break;

      default:
        throw new Error(`Unknown response type: ${result.type}`);
    }
    result = await outputStream.next();
    if (result.done) {
      break;
    }
  }

  cleanup(executor, outputStream);
}

function createMessages(
  prompt: string,
  imageUrl?: string,
  toolCallHistory?: boolean,
) {
  const systemMessage = {
    role: 'system',
    content:
      'You are a helpful assistant that can use tools when needed. When analyzing images, describe what you see and use appropriate tools if calculations or weather information is needed.',
  };

  const previousUserMessage = {
    role: 'user',
    content: 'Hi please call the calculator tool to calculate 2 + 2',
  };

  const firstAssistantMessage = {
    role: 'assistant',
    content: '',
    toolCalls: [
      {
        id: '1',
        name: 'calculator',
        args: '{"a": 2, "b": 2}',
      },
    ],
  };

  const toolMessage = {
    role: 'tool',
    toolCallId: '1',
    content: '5',
  };

  let userMessage;
  if (imageUrl) {
    userMessage = {
      role: 'user',
      content: [
        {
          type: 'text' as const,
          text: prompt,
        },
        {
          type: 'image' as const,
          image_url: {
            url: imageUrl,
            detail: 'high',
          },
        },
      ],
    };
  } else {
    userMessage = {
      role: 'user',
      content: prompt,
    };
  }

  if (toolCallHistory) {
    return {
      messages: [
        systemMessage,
        previousUserMessage,
        firstAssistantMessage,
        toolMessage,
        userMessage,
      ],
    };
  } else {
    return {
      messages: [systemMessage, userMessage],
    };
  }
}

function createMessagesWithTools(
  userPrompt: string,
  toolChoice?: string,
  imageUrl?: string,
  toolCallHistory?: boolean,
) {
  const messages = createMessages(
    userPrompt,
    imageUrl,
    toolCallHistory,
  ).messages;

  const result: any = {
    messages,
    tools: TOOLS,
  };

  if (toolChoice) {
    if (
      toolChoice === 'auto' ||
      toolChoice === 'required' ||
      toolChoice === 'none'
    ) {
      result.toolChoice = {
        choice: toolChoice,
      };
    } else {
      // Assume it's a specific function name
      result.toolChoice = {
        choice: {
          name: toolChoice,
        },
      };
    }
  }

  return result;
}

function parseArgs(): {
  prompt: string;
  modelName: string;
  provider: string;
  apiKey: string;
  tools: boolean;
  stream: boolean;
  toolChoice?: string;
  imageUrl?: string;
  responseFormat?: string;
  toolCallHistory?: boolean;
} {
  const argv = minimist(process.argv.slice(2));

  if (argv.help) {
    console.log(usage);
    process.exit(0);
  }
  const prompt = argv._?.join(' ') || '';
  const modelName = argv.modelName || DEFAULT_LLM_MODEL_NAME;
  const provider = argv.provider || 'inworld';
  const apiKey = process.env.INWORLD_API_KEY || '';
  const tools = !!argv.tools;
  const stream = argv.stream !== undefined ? argv.stream === 'true' : true;
  const toolChoice = argv.toolChoice || undefined;
  const imageUrl = argv.imageUrl || undefined;
  const responseFormat = argv.responseFormat || undefined;
  const toolCallHistory =
    argv.toolCallHistory !== undefined
      ? argv.toolCallHistory === 'true'
      : false;

  if (!prompt) {
    throw new Error(`You need to provide a prompt.\n${usage}`);
  }

  if (!apiKey) {
    throw new Error(
      `You need to set INWORLD_API_KEY environment variable.\n${usage}`,
    );
  }

  return {
    prompt,
    modelName,
    provider,
    apiKey,
    tools,
    stream,
    toolChoice,
    imageUrl,
    responseFormat,
    toolCallHistory,
  };
}

bindProcessHandlers();
