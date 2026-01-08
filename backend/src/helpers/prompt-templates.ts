/**
 * Prompt Templates for Multi-Language Support
 *
 * Templates are loaded from .njk files in the /prompts folder.
 * All templates use Jinja2-style variables that are injected at runtime:
 * - {{target_language}} - English name of target language (e.g., "Spanish")
 * - {{target_language_native}} - Native name (e.g., "Español")
 * - {{teacher_name}} - Teacher persona name
 * - {{teacher_description}} - Full teacher persona description
 * - {{example_topics}} - Comma-separated list of conversation topics
 */

import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const promptsDir = join(__dirname, '..', 'prompts');

async function loadTemplate(name: string): Promise<string> {
  const content = await readFile(join(promptsDir, `${name}.njk`), 'utf-8');
  return content.trim();
}

export const conversationTemplate = await loadTemplate('conversation');
export const flashcardPromptTemplate = await loadTemplate('flashcard');
export const responseFeedbackPromptTemplate =
  await loadTemplate('response-feedback');
