import 'dotenv/config';

import {
  CustomNode,
  GraphBuilder,
  GraphTypes,
  ProcessContext,
} from '@inworld/runtime/graph';
import { renderJinja } from '@inworld/runtime/primitives/llm';
import { readFileSync } from 'fs';
import * as path from 'path';

import { bindProcessHandlers } from '../../helpers/cli_helpers';

const minimist = require('minimist');

class JinjaRenderNode extends CustomNode {
  async process(
    context: ProcessContext,
    opts: GraphTypes.Custom<{ prompt: string; promptProps: string }>,
  ): Promise<GraphTypes.Custom> {
    return { renderedPrompt: await renderJinja(opts.prompt, opts.promptProps) };
  }
}

const usage = `
Usage:
    yarn node-custom-jinja \n
    --prompt=<path-to-prompt-file>[optional, a default file can be loaded instead] \n
    --promptProps=<path-to-prompt-vars-file>[optional, a default file can be loaded instead]

Description:
    This example demonstrates how to create a custom node that renders a Jinja template.
    The node is asynchronous and will return the rendered prompt.
`;

run();

async function run() {
  const args = parseArgs();

  const customNode = new JinjaRenderNode();
  const prompt = readFileSync(args.prompt, 'utf8');
  const promptProps = readFileSync(args.promptProps, 'utf8');

  const graph = new GraphBuilder('custom_jinja_graph')
    .addNode(customNode)
    .setStartNode(customNode)
    .setEndNode(customNode)
    .build();

  const outputStream = graph.start({
    prompt,
    promptProps,
  });

  const response = await outputStream.next();

  await response.processResponse({
    Custom: (data) => {
      const customData = data as { renderedPrompt: string };
      console.log(
        '\n\n\x1b[45m Rendered Jinja Template: \x1b[0m\n\n',
        customData.renderedPrompt,
      );
    },
  });
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
