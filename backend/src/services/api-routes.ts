/**
 * API Routes
 *
 * Express router for REST API endpoints.
 */

import { Router } from 'express';
import { AnkiExporter } from '../helpers/anki-exporter.js';
import {
  getLanguageOptions,
  DEFAULT_LANGUAGE_CODE,
} from '../config/languages.js';
import { serverLogger as logger } from '../utils/logger.js';

export const apiRouter = Router();

// ANKI export endpoint
apiRouter.post('/export-anki', async (req, res) => {
  try {
    const { flashcards, deckName, languageCode } = req.body;

    if (!flashcards || !Array.isArray(flashcards) || flashcards.length === 0) {
      res.status(400).json({ error: 'No flashcards provided' });
      return;
    }

    const exporter = new AnkiExporter();
    const validCount = exporter.countValidFlashcards(flashcards);

    if (validCount === 0) {
      res.status(400).json({ error: 'No valid flashcards to export' });
      return;
    }

    const defaultDeckName = `Inworld Language Tutor ${languageCode || 'Language'} Cards`;
    const apkgBuffer = await exporter.exportFlashcards(
      flashcards,
      deckName || defaultDeckName
    );

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${(deckName || defaultDeckName).replace(/[^a-zA-Z0-9]/g, '_')}.apkg"`
    );
    res.send(apkgBuffer);
  } catch (error) {
    logger.error({ err: error }, 'anki_export_error');
    res.status(500).json({ error: 'Failed to export Anki deck' });
  }
});

// Languages endpoint
apiRouter.get('/languages', (_req, res) => {
  try {
    const languages = getLanguageOptions();
    res.json({ languages, defaultLanguage: DEFAULT_LANGUAGE_CODE });
  } catch (error) {
    logger.error({ err: error }, 'get_languages_error');
    res.status(500).json({ error: 'Failed to get languages' });
  }
});

// Health check endpoint for Cloud Run
apiRouter.get('/health', (_req, res) => {
  res
    .status(200)
    .json({ status: 'healthy', timestamp: new Date().toISOString() });
});
