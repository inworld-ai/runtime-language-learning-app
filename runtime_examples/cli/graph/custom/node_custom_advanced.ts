import {
  CustomInputDataType,
  CustomOutputDataType,
  GraphBuilder,
  NodeFactory,
  registerCustomNodeType,
} from '@inworld/runtime/graph';
import { v4 } from 'uuid';

import { bindProcessHandlers, cleanup } from '../../helpers/cli_helpers';

const minimist = require('minimist');

interface AdvancedTextNodeConfig {
  mode: string;
  prefix: string;
  suffix: string;
}

const advancedTextNodeType = registerCustomNodeType(
  'AdvancedTextNode',
  [CustomInputDataType.TEXT],
  CustomOutputDataType.TEXT,
  (context, input) => {
    const text = input;
    const config: AdvancedTextNodeConfig = context.executionConfig
      .properties as unknown as AdvancedTextNodeConfig;

    // Handle different processing modes based on config
    const mode = config.mode || 'uppercase';
    const prefix = config.prefix || '';
    const suffix = config.suffix || '';

    let processedText = text;

    switch (mode) {
      case 'uppercase':
        processedText = text.toUpperCase();
        break;
      case 'lowercase':
        processedText = text.toLowerCase();
        break;
      case 'reverse':
        processedText = text.split('').reverse().join('');
        break;
      case 'titlecase':
        processedText = text.replace(
          /\w\S*/g,
          (txt: string) =>
            txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase(),
        );
        break;
      default:
        processedText = text;
    }

    return `${prefix}${processedText}${suffix}`;
  },
);

const usage = `
Usage:
    yarn node-custom-advanced "Hello, world!" \n
    --mode=<mode>[optional, default=uppercase] - Processing mode: uppercase, lowercase, reverse, titlecase \n
    --prefix=<prefix>[optional] - Text to add before the processed text \n
    --suffix=<suffix>[optional] - Text to add after the processed text \n
    --help - Show this help message`;

run();

async function run() {
  const { prompt, mode, prefix, suffix } = parseArgs();

  // Create custom node
  const advancedTextNode = NodeFactory.createCustomNode(
    'advanced-text-node',
    advancedTextNodeType,
    {
      reportToClient: true,
      executionConfigProperties: {
        mode: mode || 'uppercase',
        prefix: prefix || '',
        suffix: suffix || '',
      },
    },
  );

  const executor = new GraphBuilder('node_custom_advanced_graph')
    .addNode(advancedTextNode)
    .setStartNode(advancedTextNode)
    .setEndNode(advancedTextNode)
    .getExecutor();

  const outputStream = await executor.execute(
    {
      text: prompt,
      config: {
        mode: mode || 'uppercase',
        prefix: prefix || '',
        suffix: suffix || '',
      },
    },
    v4(),
  );

  let result = (await outputStream.next()).data;

  console.log(`Original text: ${prompt}`);
  console.log(`Processed text: ${result}`);
  console.log(`Mode used: ${mode || 'uppercase'}`);

  cleanup(executor, outputStream);
}

function parseArgs(): {
  prompt: string;
  mode?: string;
  prefix?: string;
  suffix?: string;
} {
  const argv = minimist(process.argv.slice(2));

  if (argv.help) {
    console.log(usage);
    process.exit(0);
  }
  const prompt = argv._?.join(' ') || '';
  const mode = argv.mode;
  const prefix = argv.prefix;
  const suffix = argv.suffix;

  if (!prompt) {
    throw new Error(`You need to provide a prompt.\n${usage}`);
  }

  return { prompt, mode, prefix, suffix };
}

bindProcessHandlers();
