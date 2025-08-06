import 'dotenv/config';

import {
  ContentInterface,
  InworldError,
  TTSOutputStreamIterator,
  UserContext,
} from '@inworld/runtime/common';
import {
  AudioResponse,
  ComponentFactory,
  CustomInputDataTypeTyped,
  CustomOutputDataType,
  CustomOutputDataTypeTyped,
  GraphBuilder,
  GraphExecutor,
  GraphOutputStreamResponseType,
  NodeFactory,
  registerCustomNodeType,
} from '@inworld/runtime/graph';
import * as telemetry from '@inworld/runtime/telemetry';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { v4 } from 'uuid';

import {
  DEFAULT_LLM_MODEL_NAME,
  DEFAULT_TTS_MODEL_ID,
  DEFAULT_VOICE_ID,
  SAMPLE_RATE,
  TEXT_CONFIG,
} from '../../constants';

const OUTPUT_DIRECTORY = path.join(
  __dirname,
  '..',
  '..',
  'data-output',
  'character_generator_dsl_samples',
);

const minimist = require('minimist');
const wavEncoder = require('wav-encoder');
const { spawn } = require('child_process');

// Console colors
const GREEN = '\x1b[92m';
const RED = '\x1b[91m';
const BLUE = '\x1b[94m';
const RESET = '\x1b[0m';

// Data structures for node communication
interface Character {
  name: string;
  setting: string;
  asset: string;
  quest: string;
  history: string[];
}

interface GameState {
  characters: { [key: string]: Character };
  currentCharacter: Character | null;
  quests: string[];
}

interface TextInput {
  text: string;
}

interface InstructInput {
  type: 'instruct';
  text: string;
}

interface SelectCharacter {
  type: 'select';
  name: string;
}

interface ChatInput {
  type: 'chat';
  name: string;
  text: string;
}

interface ComposedCharacterInfo {
  instruct: InstructInput;
  quests: string[];
  assets: string[];
}

interface CharacterResponse {
  name: string;
  text: string;
}

// Global game state
let gameState: GameState = {
  characters: {},
  currentCharacter: null,
  quests: [
    'Find the lost treasure in the ancient ruins',
    'Defeat the dragon terrorizing the village',
    'Collect rare herbs for the village healer',
    'Escort the merchant caravan safely',
    'Investigate mysterious disappearances',
    'Defend the castle from invaders',
    'Solve the riddle of the ancient temple',
    'Rescue the kidnapped princess',
    'Discover the source of the plague',
    'Unite the warring factions',
  ],
};

function registerCustomNodes() {
  // Input Router Node - routes commands to appropriate data types
  const inputRouterNodeType = registerCustomNodeType(
    'InputRouterNode',
    [CustomInputDataTypeTyped<TextInput>()],
    CustomOutputDataTypeTyped<InstructInput | SelectCharacter | ChatInput>(),
    (_context, textInput) => {
      const text = textInput.text.trim();

      if (text.startsWith('create:')) {
        return { type: 'instruct', text: text.substring(7) } as InstructInput;
      } else if (text.startsWith('select:')) {
        return { type: 'select', name: text.substring(7) } as SelectCharacter;
      } else if (text === 'quit') {
        process.exit(0);
      } else {
        const currentCharacter = gameState.currentCharacter;
        if (!currentCharacter) {
          console.log(
            `${RED}No character selected. Use 'select:<character-name>' first${RESET}`,
          );
          return { type: 'chat', name: '', text: text } as ChatInput;
        }
        return {
          type: 'chat',
          name: currentCharacter.name,
          text: text,
        } as ChatInput;
      }
    },
  );

  // Character Assets Fetcher Node - generates assets using LLM
  const characterAssetsFetcherNodeType = registerCustomNodeType(
    'CharacterAssetsFetcherNode',
    [CustomInputDataTypeTyped<InstructInput>()],
    CustomOutputDataType.CUSTOM,
    (_context, instructInput) => {
      return { setting: instructInput.text };
    },
  );

  // Character Quest Fetcher Node - filters quests using LLM
  const characterQuestFetcherNodeType = registerCustomNodeType(
    'CharacterQuestFetcherNode',
    [CustomInputDataTypeTyped<InstructInput>()],
    CustomOutputDataType.CUSTOM,
    (_context, instructInput) => {
      return {
        setting: instructInput.text,
        quests: gameState.quests
          .map((quest, index) => `${index}: ${quest}`)
          .join('\n'),
      };
    },
  );

  // State Collector Node - gathers all inputs before composing the character
  const stateCollectorNodeType = registerCustomNodeType(
    'StateCollectorNode',
    [
      CustomInputDataTypeTyped<InstructInput>(),
      CustomInputDataTypeTyped<ContentInterface>(),
      CustomInputDataTypeTyped<ContentInterface>(),
    ],
    CustomOutputDataType.CUSTOM,
    (_context, instructInput, assetsText, questsText) => {
      const result: ComposedCharacterInfo = {
        instruct: instructInput,
        assets: assetsText.content
          .split('\n')
          .filter((asset: string) => asset.trim().length > 0),
        quests: questsText.content
          .split('\n')
          .filter((quest: string) => quest.trim().length > 0),
      };
      return result;
    },
  );

  // Character Composer Node - composes characters from assets and quests
  const characterComposerNodeType = registerCustomNodeType(
    'CharacterComposerNode',
    [CustomInputDataTypeTyped<ComposedCharacterInfo>()],
    CustomOutputDataTypeTyped<Character>(),
    (_context, finalState) => {
      const instructInput = finalState.instruct;
      const assetsTexts = finalState.assets;
      const questsTexts = finalState.quests.map((q) => q.toString());

      const questsList = questsTexts
        .filter((q) => q.trim().length > 0)
        .map((q) => parseInt(q.trim()))
        .filter((q) => !isNaN(q) && q >= 0 && q < gameState.quests.length)
        .map((i) => i.toString());

      // Create character
      const questIndex =
        questsList.length > 0
          ? parseInt(questsList[Math.floor(Math.random() * questsList.length)])
          : 0;

      const charId = Object.keys(gameState.characters).length + 1;

      const character: Character = {
        name: `Character-${charId}`,
        setting: instructInput.text,
        asset:
          assetsTexts[Math.floor(Math.random() * assetsTexts.length)] ||
          'Basic outfit',
        quest: gameState.quests[questIndex] || 'No quest available',
        history: [],
      };

      return character;
    },
  );

  // Character Deployer Node - deploys characters to game state
  const characterDeployerNodeType = registerCustomNodeType(
    'CharacterDeployerNode',
    [CustomInputDataTypeTyped<Character>()],
    CustomOutputDataType.TEXT,
    (_context, character) => {
      gameState.characters[character.name] = character;

      return JSON.stringify({ deployed: character.name });
    },
  );

  // Character Selector Node - selects a character for interaction
  const characterSelectorNodeType = registerCustomNodeType(
    'CharacterSelectorNode',
    [CustomInputDataTypeTyped<SelectCharacter>()],
    CustomOutputDataTypeTyped<CharacterResponse>(),
    (_context, selectCharacter) => {
      let character = gameState.characters[selectCharacter.name];

      // If not found by exact name, try Character-{id} pattern
      if (!character) {
        const justNumberMatch = selectCharacter.name.match(/^\d+$/);
        if (justNumberMatch) {
          const characterName = `Character-${selectCharacter.name}`;
          character = gameState.characters[characterName];
        }
      }

      if (!character) {
        return {
          name: '',
          text: `Character not found. Available characters: ${Object.keys(gameState.characters).join(', ')}`,
        } as CharacterResponse;
      }

      gameState.currentCharacter = character;

      const greetingText = `Hello, I'm ${character.name}. I'm ready to talk about my quest.`;
      return {
        name: character.name,
        text: greetingText,
      } as CharacterResponse;
    },
  );

  // Character Response Generator Node - generates chat responses using LLM
  const characterResponseGeneratorNodeType = registerCustomNodeType(
    'CharacterResponseGeneratorNode',
    [CustomInputDataTypeTyped<ChatInput>()],
    CustomOutputDataType.CHAT_REQUEST,
    (_context, chatInput) => {
      if (!chatInput.name || chatInput.name === '') {
        console.log(`${RED}No character selected for chat${RESET}`);
        return [];
      }

      const character = gameState.characters[chatInput.name];
      if (!character) {
        console.log(`${RED}Character '${chatInput.name}' not found${RESET}`);
        return [];
      }

      const chatPrompt = `You are a game character NPC in the game world with theme setting described as: ${character.setting}
  You have the following quest to give to the user: ${character.quest}
  Your goal is to explain the quest to the user and ask for confirmation.
  Here is a history of the conversation you had with this user so far: ${character.history.join(' | ')}

  Respond in a concise manner to the following user message: ${chatInput.text}`;

      return [{ role: 'user', content: chatPrompt }];
    },
  );

  // History Logger Node - logs chat history
  const historyLoggerNodeType = registerCustomNodeType(
    'HistoryLoggerNode',
    [
      CustomInputDataTypeTyped<ContentInterface>(),
      CustomInputDataTypeTyped<ChatInput>(),
    ],
    CustomOutputDataTypeTyped<CharacterResponse>(),
    (_context, content, chatInput) => {
      const llmResponseText = content.content;

      if (llmResponseText.startsWith('SYSTEM_ERROR:')) {
        const errorText = llmResponseText.substring(13);
        const errorResponse = { name: chatInput.name, text: errorText };
        console.log(`${RED}Error: ${errorText}${RESET}`);
        return errorResponse;
      }

      const characterResponse = { name: chatInput.name, text: llmResponseText };
      const character = gameState.characters[chatInput.name];
      if (character) {
        character.history.push(`user: ${chatInput.text}`);
        character.history.push(`character: ${characterResponse.text}`);
      } else {
        console.log(`${RED}Character not found for logging history.${RESET}`);
      }

      return characterResponse;
    },
  );

  // TTS Text Extractor Node - extracts text from CharacterResponse for TTS
  const ttsTextExtractorNodeType = registerCustomNodeType(
    'TTSTextExtractorNode',
    [CustomInputDataTypeTyped<CharacterResponse>()],
    CustomOutputDataType.TEXT,
    (_context, inputText) => {
      try {
        const actualText = inputText.text;
        return actualText || '';
      } catch (error) {
        console.error(`${RED}Error parsing input:${RESET}`, error);
        const fallbackText = inputText.text || '';
        console.log(`${BLUE}Using fallback text:${RESET}`, fallbackText);
        return fallbackText;
      }
    },
  );

  return {
    inputRouterNodeType,
    characterAssetsFetcherNodeType,
    characterQuestFetcherNodeType,
    stateCollectorNodeType,
    characterComposerNodeType,
    characterDeployerNodeType,
    characterSelectorNodeType,
    characterResponseGeneratorNodeType,
    historyLoggerNodeType,
    ttsTextExtractorNodeType,
  };
}

// Main Character Generator DSL Graph System
class CharacterGeneratorDSLGraph {
  private graphBuilder: GraphBuilder;
  private executor: GraphExecutor;

  constructor(
    private apiKey: string,
    private modelName: string,
    private voiceName: string,
    private initType: number = 1,
  ) {}

  async initialize() {
    // Register custom node types using DSL approach
    console.log(
      `${GREEN}Registering custom node types with DSL (method ${this.initType})...${RESET}`,
    );
    const {
      inputRouterNodeType,
      characterAssetsFetcherNodeType,
      characterQuestFetcherNodeType,
      stateCollectorNodeType,
      characterComposerNodeType,
      characterDeployerNodeType,
      characterSelectorNodeType,
      characterResponseGeneratorNodeType,
      historyLoggerNodeType,
      ttsTextExtractorNodeType,
    } = registerCustomNodes();

    // Create graph using DSL
    console.log(`${GREEN}Creating graph using DSL...${RESET}`);
    this.graphBuilder = new GraphBuilder('character_generator_dsl_graph');

    // Create and add custom nodes
    const inputRouterNode = NodeFactory.createCustomNode(
      'input-router',
      inputRouterNodeType,
    );

    const assetsFetcherNode = NodeFactory.createCustomNode(
      'assets-fetcher',
      characterAssetsFetcherNodeType,
    );

    const questFetcherNode = NodeFactory.createCustomNode(
      'quest-fetcher',
      characterQuestFetcherNodeType,
    );

    const stateCollectorNode = NodeFactory.createCustomNode(
      'state-collector',
      stateCollectorNodeType,
    );

    const characterComposerNode = NodeFactory.createCustomNode(
      'character-composer',
      characterComposerNodeType,
      {
        reportToClient: true,
      },
    );

    const characterDeployerNode = NodeFactory.createCustomNode(
      'character-deployer',
      characterDeployerNodeType,
      {
        reportToClient: true,
      },
    );

    const characterSelectorNode = NodeFactory.createCustomNode(
      'character-selector',
      characterSelectorNodeType,
    );

    const responseGeneratorNode = NodeFactory.createCustomNode(
      'response-generator',
      characterResponseGeneratorNodeType,
    );

    const historyLoggerNode = NodeFactory.createCustomNode(
      'history-logger',
      historyLoggerNodeType,
    );

    const ttsTextExtractorNode = NodeFactory.createCustomNode(
      'tts-text-extractor',
      ttsTextExtractorNodeType,
      {
        reportToClient: true,
      },
    );

    const llmComponent = ComponentFactory.createRemoteLLMComponent({
      id: 'llm-component',
      provider: 'inworld',
      modelName: this.modelName,
      apiKey: this.apiKey,
      defaultConfig: TEXT_CONFIG,
    });

    // Create LLM nodes
    const llmNode = NodeFactory.createRemoteLLMChatNode({
      id: 'llm-node',
      executionConfig: {
        llmComponentId: llmComponent.id,
        stream: false,
      },
    });

    const llmAssetsRequestBuilderNode =
      NodeFactory.createLLMChatRequestBuilderNode({
        id: 'llm-assets-request_builder-node',
        messages: [
          {
            role: 'user',
            content: {
              type: 'template',
              template:
                'Please generate 3 items for the game character to wear in the game world with the theme described as: {{setting}}\n  Output only name of the items. Each item should be on the new line.',
            },
          },
        ],
      });

    const llmAssetsNode = NodeFactory.createRemoteLLMChatNode({
      id: 'llm-assets-node',
      executionConfig: {
        llmComponentId: llmComponent.id,
        stream: false,
      },
    });

    const llmQuestsRequestBuilderNode =
      NodeFactory.createLLMChatRequestBuilderNode({
        id: 'llm-quests-request_builder-node',
        messages: [
          {
            role: 'user',
            content: {
              type: 'template',
              template: `You need to filter out quests from the list of quests and choose all quests which are appropriate to the following game setting: {{setting}}

  Here is the list of quests:
  {{quests}}

  Output only quest numbers, each on new line`,
            },
          },
        ],
      });

    const llmQuestsNode = NodeFactory.createRemoteLLMChatNode({
      id: 'llm-quests-node',
      executionConfig: {
        llmComponentId: llmComponent.id,
        stream: false,
      },
    });

    const ttsComponent = ComponentFactory.createRemoteTTSComponent({
      id: 'tts-component',
      apiKey: this.apiKey,
      synthesisConfig: {
        type: 'inworld',
        config: {
          modelId: DEFAULT_TTS_MODEL_ID,
          postprocessing: {
            sampleRate: SAMPLE_RATE,
          },
          inference: {
            temperature: 0.7,
            pitch: 0.0,
            speakingRate: 1.0,
          },
        },
      },
    });

    // Create TTS node
    const ttsNode = NodeFactory.createRemoteTTSNode({
      id: 'tts-node',
      ttsComponentId: ttsComponent.id,
      voice: {
        speakerId: this.voiceName,
      },
      synthesisConfig: {
        type: 'inworld',
        config: {
          modelId: DEFAULT_TTS_MODEL_ID,
          postprocessing: {
            sampleRate: SAMPLE_RATE,
          },
          inference: {
            temperature: 0.7,
            pitch: 0.0,
            speakingRate: 1.0,
          },
        },
      },
    });

    // Add components to graph
    this.graphBuilder.addComponent(llmComponent).addComponent(ttsComponent);

    // Add all nodes to graph
    this.graphBuilder
      .addNode(inputRouterNode)
      .addNode(assetsFetcherNode)
      .addNode(questFetcherNode)
      .addNode(stateCollectorNode)
      .addNode(characterComposerNode)
      .addNode(characterDeployerNode)
      .addNode(characterSelectorNode)
      .addNode(responseGeneratorNode)
      .addNode(historyLoggerNode)
      .addNode(ttsTextExtractorNode)
      .addNode(llmNode)
      .addNode(llmAssetsRequestBuilderNode)
      .addNode(llmQuestsRequestBuilderNode)
      .addNode(llmAssetsNode)
      .addNode(llmQuestsNode)
      .addNode(ttsNode);

    // Create edges using DSL approach with conditions
    // Create flow edges
    this.graphBuilder
      .addEdge(inputRouterNode, assetsFetcherNode, {
        conditionExpression: 'input.type == "instruct"',
      })
      .addEdge(assetsFetcherNode, llmAssetsRequestBuilderNode)
      .addEdge(llmAssetsRequestBuilderNode, llmAssetsNode)
      .addEdge(inputRouterNode, questFetcherNode, {
        conditionExpression: 'input.type == "instruct"',
      })
      .addEdge(questFetcherNode, llmQuestsRequestBuilderNode)
      .addEdge(llmQuestsRequestBuilderNode, llmQuestsNode)
      .addEdge(inputRouterNode, stateCollectorNode, {
        conditionExpression: 'input.type == "instruct"',
      })
      .addEdge(llmAssetsNode, stateCollectorNode)
      .addEdge(llmQuestsNode, stateCollectorNode)
      .addEdge(stateCollectorNode, characterComposerNode)
      .addEdge(characterComposerNode, characterDeployerNode);

    // Select flow edges
    this.graphBuilder
      .addEdge(inputRouterNode, characterSelectorNode, {
        conditionExpression: 'input.type == "select"',
      })
      .addEdge(characterSelectorNode, ttsTextExtractorNode, {
        conditionExpression: 'input.name != ""',
        optional: true,
      });

    // Chat flow edges
    this.graphBuilder
      .addEdge(inputRouterNode, responseGeneratorNode, {
        conditionExpression: 'input.type == "chat"',
      })
      .addEdge(responseGeneratorNode, llmNode)
      .addEdge(llmNode, historyLoggerNode)
      .addEdge(inputRouterNode, historyLoggerNode, {
        conditionExpression: 'input.type == "chat"',
      })
      .addEdge(historyLoggerNode, ttsTextExtractorNode, {
        optional: true,
      })
      .addEdge(ttsTextExtractorNode, ttsNode);

    // Set start and end nodes
    this.graphBuilder
      .setStartNode(inputRouterNode)
      .setEndNode(characterDeployerNode)
      .setEndNode(characterSelectorNode)
      .setEndNode(ttsNode);

    console.log(
      `${GREEN}Character Generator DSL Graph initialized successfully!${RESET}`,
    );
    console.log(`${BLUE}Commands:${RESET}`);
    console.log(
      `${BLUE}  create:<setting> - Create characters for a setting${RESET}`,
    );
    console.log(
      `${BLUE}  select:<character-name> - Select a character to chat with${RESET}`,
    );
    console.log(`${BLUE}  <message> - Chat with selected character${RESET}`);
    console.log(`${BLUE}  quit - Exit the system${RESET}`);

    this.executor = this.graphBuilder.getExecutor();
  }

  async processInput(input: TextInput): Promise<void> {
    try {
      const userId = v4();
      const userContext = new UserContext(
        {
          user_id: userId,
          age: '48',
        },
        userId,
      );

      const outputStream = await this.executor.execute(
        input,
        v4(),
        userContext,
      );

      // Process all output results
      let result = await outputStream.next();

      while (!result.done) {
        await this.handleOutput(result);
        result = await outputStream.next();
      }

      console.log(`${GREEN}Input processed successfully!${RESET}`);
      this.executor.closeExecution(outputStream);
    } catch (error) {
      console.error(`${RED}Error processing input: ${error}${RESET}`);
    }
  }

  private async handleOutput(result: any): Promise<void> {
    console.log(`${GREEN}Received result type: ${result.type}${RESET}`);

    switch (result.type) {
      case GraphOutputStreamResponseType.TTS_OUTPUT_STREAM:
        console.log(`${BLUE}🎵 Processing TTS audio stream...${RESET}`);
        await this.handleTTSOutput(result.data as TTSOutputStreamIterator);
        break;

      case GraphOutputStreamResponseType.CUSTOM:
        console.log(`${BLUE}📋 Processing JSON data...${RESET}`);
        console.log(
          `${GREEN}JSON Result:${RESET}`,
          JSON.stringify(result.data, null, 2),
        );
        break;

      case GraphOutputStreamResponseType.TEXT:
        console.log(`${BLUE}🔤 Processing text data...${RESET}`);
        console.log(`${GREEN}Text Result: ${result.data}${RESET}`);
        break;

      default:
        console.log(
          `${BLUE}❓ Processing unknown output type: ${result.type}${RESET}`,
        );
        if (result.data) {
          console.log(
            `${GREEN}Unknown Data:${RESET}`,
            JSON.stringify(result.data, null, 2),
          );
        }
        break;
    }
  }

  private async handleTTSOutput(
    ttsStream: TTSOutputStreamIterator,
  ): Promise<void> {
    try {
      let allAudioData: number[] = [];
      let chunk: AudioResponse = await ttsStream.next();

      while (!chunk.done) {
        allAudioData = allAudioData.concat(Array.from(chunk.audio.data));
        chunk = await ttsStream.next();
      }

      // Create audio file
      const audio = {
        sampleRate: SAMPLE_RATE,
        channelData: [new Float32Array(allAudioData)],
      };

      const buffer = await wavEncoder.encode(audio);
      if (!fs.existsSync(OUTPUT_DIRECTORY)) {
        fs.mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
      }

      // Use current character name if available
      const characterName = gameState.currentCharacter?.name || 'character';
      const audioFile = path.join(
        OUTPUT_DIRECTORY,
        `${characterName}_${Date.now()}.wav`,
      );
      fs.writeFileSync(audioFile, Buffer.from(buffer));

      console.log(
        `${BLUE}🎵 Playing ${characterName}'s voice... (${audioFile})${RESET}`,
      );

      // Play the audio file (platform-specific)
      const platform = process.platform;
      if (platform === 'darwin') {
        spawn('afplay', [audioFile], { stdio: 'ignore' });
      } else if (platform === 'linux') {
        spawn('aplay', [audioFile], { stdio: 'ignore' });
      } else if (platform === 'win32') {
        spawn('start', [audioFile], { stdio: 'ignore', shell: true });
      }
    } catch (error) {
      console.error(`${RED}Error handling TTS output: ${error}${RESET}`);
    }
  }

  async cleanup(): Promise<void> {
    if (this.executor) {
      this.executor.stopExecutor();
      this.executor.cleanupAllExecutions();
      this.executor.destroy();
      this.executor = null;
    }
    if (this.graphBuilder) {
      this.graphBuilder = null;
    }
    telemetry.shutdownTelemetry();
  }
}

const usage = `
Usage:
    yarn character-generator [options]
    
Options:
    --modelName=<model-name>[optional, default=${DEFAULT_LLM_MODEL_NAME}]
    --voiceName=<voice-id>[optional, default=${DEFAULT_VOICE_ID}]
    
Examples:
    yarn character-generator
    yarn character-generator --voiceName=en-US-AriaNeural --initType=2
    
Interactive Commands:
    create:futuristic world full of cats and robots
    create:medieval world full of knights and castles
    select:Character-1
    Hello, what's your quest?
    quit
`;

let characterGraph: CharacterGeneratorDSLGraph | null = null;

async function main() {
  const { modelName, voiceName, apiKey, initType } = parseArgs();

  characterGraph = new CharacterGeneratorDSLGraph(
    apiKey,
    modelName,
    voiceName,
    initType,
  );
  await characterGraph.initialize();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askQuestion = (): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(`${BLUE}Enter input: ${RESET}`, (answer) => {
        resolve(answer);
      });
    });
  };

  try {
    while (true) {
      const userInput = await askQuestion();
      if (userInput.trim().toLowerCase() === 'quit') {
        break;
      }
      await characterGraph.processInput({ text: userInput });
    }
  } catch (error) {
    console.error(`${RED}Error: ${error}${RESET}`);
  } finally {
    rl.close();
    await characterGraph.cleanup();
  }
}

function parseArgs(): {
  modelName: string;
  voiceName: string;
  apiKey: string;
  initType: number;
} {
  const argv = minimist(process.argv.slice(2));

  if (argv.help) {
    console.log(usage);
    process.exit(0);
  }

  const modelName = argv.modelName || DEFAULT_LLM_MODEL_NAME;
  const voiceName = argv.voiceName || DEFAULT_VOICE_ID;
  const initType = parseInt(argv.initType) || 1;
  const apiKey = process.env.INWORLD_API_KEY || '';

  if (!apiKey) {
    throw new Error(
      `You need to set INWORLD_API_KEY environment variable.\n${usage}`,
    );
  }

  // Validate initType
  if (initType !== 1 && initType !== 2) {
    throw new Error(`Invalid initType: ${initType}. Must be 1 or 2.\n${usage}`);
  }

  return { modelName, voiceName, apiKey, initType };
}

function done() {
  if (characterGraph) {
    characterGraph.cleanup();
  }
  process.exit(0);
}

process.on('SIGINT', done);
process.on('SIGTERM', done);
process.on('SIGUSR2', done);
process.on('unhandledRejection', (err: Error) => {
  if (err instanceof InworldError) {
    console.error('Inworld Error: ', {
      message: err.message,
      context: err.context,
    });
  } else {
    console.error(err);
  }
  if (characterGraph) {
    characterGraph.cleanup();
  }
  process.exit(1);
});

// Run the main function
main().catch(console.error);
