// Load environment variables FIRST
import dotenv from 'dotenv';
dotenv.config();
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Basic imports
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { telemetry } from '@inworld/runtime';
import { MetricType } from '@inworld/runtime/telemetry';
import { UserContext } from '@inworld/runtime/graph';

// Import our audio processor
import { AudioProcessor } from './helpers/audio-processor.ts';
import { FlashcardProcessor } from './helpers/flashcard-processor.ts';
import { AnkiExporter } from './helpers/anki-exporter.ts';
import { IntroductionStateProcessor } from './helpers/introduction-state-processor.ts';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Add JSON parsing middleware
app.use(express.json());

const PORT = 3001;

// Initialize telemetry once at startup
try {
  const telemetryApiKey = process.env.INWORLD_API_KEY;
  if (telemetryApiKey) {
    telemetry.init({
      apiKey: telemetryApiKey,
      appName: 'Aprendemo',
      appVersion: '1.0.0'
    });

    telemetry.configureMetric({
      metricType: MetricType.COUNTER_UINT,
      name: 'flashcard_clicks_total',
      description: 'Total flashcard clicks',
      unit: 'clicks'
    });
  } else {
    console.warn('[Telemetry] INWORLD_API_KEY not set. Metrics will be disabled.');
  }
} catch (err) {
  console.error('[Telemetry] Initialization failed:', err);
}

// Store audio processors per connection
const audioProcessors = new Map<string, AudioProcessor>();
const flashcardProcessors = new Map<string, FlashcardProcessor>();
const introductionStateProcessors = new Map<string, IntroductionStateProcessor>();
// Store lightweight per-connection attributes provided by the client (e.g., timezone, userId)
const connectionAttributes = new Map<string, { timezone?: string; userId?: string }>();

// WebSocket handling with audio processing
wss.on('connection', (ws) => {
    const connectionId = `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log(`WebSocket connection established: ${connectionId}`);
    
    // Create audio processor for this connection  
    const apiKey = process.env.INWORLD_API_KEY || '';
    const audioProcessor = new AudioProcessor(apiKey, ws);
    const flashcardProcessor = new FlashcardProcessor();
    const introductionStateProcessor = new IntroductionStateProcessor();
    
    audioProcessors.set(connectionId, audioProcessor);
    flashcardProcessors.set(connectionId, flashcardProcessor);
    introductionStateProcessors.set(connectionId, introductionStateProcessor);
    
    // Set up flashcard generation callback
    audioProcessor.setFlashcardCallback(async (messages) => {
        try {
            // Build UserContext for flashcard graph execution
            const introState = introductionStateProcessor.getState();
            const attrs = connectionAttributes.get(connectionId) || {};
            const userAttributes: Record<string, string> = {
                timezone: attrs.timezone || ''
            };
            userAttributes.name = (introState?.name && introState.name.trim()) || 'unknown';
            userAttributes.level = (introState?.level && (introState.level as string)) || 'unknown';
            userAttributes.goal = (introState?.goal && introState.goal.trim()) || 'unknown';

            // Prefer a stable targeting key from client if available, fallback to connectionId
            const targetingKey = attrs.userId || connectionId;
            const userContext = new UserContext(userAttributes, targetingKey);

            const flashcards = await flashcardProcessor.generateFlashcards(messages, 1, userContext);
            if (flashcards.length > 0) {
                ws.send(JSON.stringify({
                    type: 'flashcards_generated',
                    flashcards: flashcards
                }));
            }
        } catch (error) {
            console.error('Error generating flashcards:', error);
        }
    });
    
    // Set up introduction-state extraction callback (runs until complete)
    audioProcessor.setIntroductionStateCallback(async (messages) => {
        try {
            const currentState = introductionStateProcessor.getState();
            console.log('Server - Current introduction state before update:', currentState);
            console.log('Server - Is complete?', introductionStateProcessor.isComplete());
            
            if (introductionStateProcessor.isComplete()) {
                console.log('Server - Introduction state is complete, returning:', currentState);
                return currentState;
            }
            
            const state = await introductionStateProcessor.update(messages);
            console.log('Server - Updated introduction state:', state);
            return state;
        } catch (error) {
            console.error('Error generating introduction state:', error);
            return null;
        }
    });
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            
            if (message.type === 'audio_chunk' && message.audio_data) {
                // Process audio chunk
                audioProcessor.addAudioChunk(message.audio_data);
            } else if (message.type === 'reset_flashcards') {
                // Reset flashcards for new conversation
                const processor = flashcardProcessors.get(connectionId);
                if (processor) {
                    processor.reset();
                }
            } else if (message.type === 'user_context') {
                const timezone = message.timezone || (message.data && message.data.timezone) || undefined;
                const userId = message.userId || (message.data && message.data.userId) || undefined;
                connectionAttributes.set(connectionId, { timezone, userId });
            } else if (message.type === 'flashcard_clicked') {
                try {
                    const card = message.card || {};
                    const introState = introductionStateProcessors.get(connectionId)?.getState();
                    const attrs = connectionAttributes.get(connectionId) || {};
                    telemetry.metric.recordCounterUInt('flashcard_clicks_total', 1, {
                        connectionId,
                        cardId: card.id || '',
                        spanish: card.spanish || card.word || '',
                        english: card.english || card.translation || '',
                        source: 'ui',
                        timezone: attrs.timezone || '',
                        name: (introState?.name && introState.name.trim()) || 'unknown',
                        level: (introState?.level && (introState.level as string)) || 'unknown',
                        goal: (introState?.goal && introState.goal.trim()) || 'unknown'
                    });
                }
                catch (err) {
                    console.error('Error recording flashcard click metric:', err);
                }
            } else {
                console.log('Received non-audio message:', message.type);
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });
    
    ws.on('close', () => {
        console.log(`WebSocket connection closed: ${connectionId}`);
        
        // Clean up audio processor
        const processor = audioProcessors.get(connectionId);
        if (processor) {
            processor.destroy();
            audioProcessors.delete(connectionId);
        }
        
        // Clean up processors
        flashcardProcessors.delete(connectionId);
        introductionStateProcessors.delete(connectionId);
        connectionAttributes.delete(connectionId);
    });
});

// API endpoint for ANKI export
app.post('/api/export-anki', async (req, res) => {
  try {
    const { flashcards, deckName } = req.body;
    
    if (!flashcards || !Array.isArray(flashcards)) {
      return res.status(400).json({ error: 'Invalid flashcards data' });
    }

    const exporter = new AnkiExporter();
    const ankiBuffer = await exporter.exportFlashcards(
      flashcards, 
      deckName || 'Aprendemo Spanish Cards'
    );

    // Set headers for file download
    const filename = `${deckName || 'aprendemo_cards'}.apkg`;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', ankiBuffer.length);

    // Send the file
    res.send(ankiBuffer);
  } catch (error) {
    console.error('Error exporting to ANKI:', error);
    res.status(500).json({ error: 'Failed to export flashcards' });
  }
});

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../frontend')));

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Process terminated');
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('Process terminated');
    });
});