import 'dotenv/config';

import { renderJinja } from '@inworld/runtime/primitives/llm';
import { readFileSync } from 'fs';
import * as path from 'path';

const minimist = require('minimist');

const usage = `
Usage:
    yarn basic-jinja-template \n
    --prompt=<path-to-prompt-file>[optional, default file can be loaded instead] \n
    --promptProps=<path-to-prompt-vars-file>[optional, default file can be loaded instead]`;

run();

async function run() {
  const args = parseArgs();

  const prompt = readFileSync(args.prompt, 'utf8');
  const promptProps = readFileSync(args.promptProps, 'utf8');

  const renderedTemplate = await renderJinja(prompt, promptProps);

  console.log(
    '\n\n\x1b[45m Rendered Jinja Template: \x1b[0m\n\n',
    renderedTemplate,
  );
}

function parseArgs() {
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
