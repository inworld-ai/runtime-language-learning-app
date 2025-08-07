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

// Import our audio processor
import { AudioProcessor } from './helpers/audio-processor.ts';
import { FlashcardProcessor } from './helpers/flashcard-processor.ts';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = 3001;

// Store audio processors per connection
const audioProcessors = new Map<string, AudioProcessor>();
const flashcardProcessors = new Map<string, FlashcardProcessor>();

// WebSocket handling with audio processing
wss.on('connection', (ws) => {
    const connectionId = `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log(`WebSocket connection established: ${connectionId}`);
    
    // Create audio processor for this connection  
    const apiKey = process.env.INWORLD_API_KEY || '';
    const audioProcessor = new AudioProcessor(apiKey, ws);
    const flashcardProcessor = new FlashcardProcessor();
    
    audioProcessors.set(connectionId, audioProcessor);
    flashcardProcessors.set(connectionId, flashcardProcessor);
    
    // Set up flashcard generation callback
    audioProcessor.setFlashcardCallback(async (messages) => {
        try {
            const flashcards = await flashcardProcessor.generateFlashcards(messages, 1);
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
        
        // Clean up flashcard processor
        flashcardProcessors.delete(connectionId);
    });
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