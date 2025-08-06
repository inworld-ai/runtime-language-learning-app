import 'dotenv/config';

import {
  CustomInputDataTypeTyped,
  CustomOutputDataType,
  GraphBuilder,
  NodeFactory,
  registerCustomNodeType,
} from '@inworld/runtime/graph';
import { renderJinja } from '@inworld/runtime/primitives/llm';
import { readFileSync } from 'fs';
import * as path from 'path';
import { v4 } from 'uuid';

import { bindProcessHandlers, cleanup } from '../../helpers/cli_helpers';

const minimist = require('minimist');

const jinjaRenderNodeType = registerCustomNodeType(
  'jinja-render-node',
  [CustomInputDataTypeTyped<{ prompt: string; promptProps: string }>()],
  CustomOutputDataType.TEXT,
  async (_context, input) => {
    return renderJinja(input.prompt, input.promptProps);
  },
);

const usage = `
Usage:
    yarn node-jinja-template \n
    --prompt=<path-to-prompt-file>[optional, default file can be loaded instead] \n
    --promptProps=<path-to-prompt-vars-file>[optional, default file can be loaded instead]

Description:
    This example demonstrates how to create a custom node that renders a Jinja template.
    The node is asynchronous and will return the rendered prompt.
`;

run();

async function run() {
  const args = parseArgs();

  const prompt = readFileSync(args.prompt, 'utf8');
  const promptProps = readFileSync(args.promptProps, 'utf8');

  const customNode = NodeFactory.createCustomNode(
    'jinja-render-node',
    jinjaRenderNodeType,
  );

  const executor = new GraphBuilder('custom_jinja_graph')
    .addNode(customNode)
    .setStartNode(customNode)
    .setEndNode(customNode)
    .getExecutor();

  const outputStream = await executor.execute(
    {
      prompt,
      promptProps,
    },
    v4(),
  );
  const renderedTemplate = (await outputStream.next()).data;

  console.log(
    '\n\n\x1b[45m Rendered Jinja Template: \x1b[0m\n\n',
    renderedTemplate,
  );

  cleanup(executor, outputStream);
}

function parseArgs(): {
  prompt: string;
  promptProps: string;
} {
  const argv = minimist(process.argv.slice(2));

  if (argv.help) {
    console.log(usage);
    process.exit(0);
  }

  let prompt = argv.prompt;
  let promptProps = argv.promptProps;

  if (!prompt) {
    let promptPath = path.join(
      __dirname,
      '..',
      '..',
      '..',
      'prompts',
      'basic_prompt.jinja',
    );
    console.warn(
      '\x1b[33musing default prompt file (' + promptPath + ')\x1b[0m',
    );
    prompt = promptPath;
  }

  if (!promptProps) {
    let promptPropsPath = path.join(
      __dirname,
      '..',
      '..',
      '..',
      'prompts',
      'basic_prompt_props.json',
    );
    console.warn(
      '\x1b[33musing default promptProps file (' + promptPropsPath + ')\x1b[0m',
    );
    promptProps = promptPropsPath;
  }

  return { prompt, promptProps };
}

bindProcessHandlers();
