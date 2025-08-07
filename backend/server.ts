// Load environment variables FIRST
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from root directory
dotenv.config({ path: path.join(__dirname, '../.env') });

// Basic imports
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

// Import our audio processor
import { SimpleAudioProcessor } from './helpers/simple-audio-processor.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3001;

// Store audio processors per connection
const audioProcessors = new Map<string, SimpleAudioProcessor>();

// WebSocket handling with audio processing
wss.on('connection', (ws) => {
    const connectionId = `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log(`WebSocket connection established: ${connectionId}`);
    
    // Create audio processor for this connection  
    const apiKey = process.env.INWORLD_API_KEY || 'RVVSTzZVaWtQNDB1dWIyMngySEFhdFJidkdEdUNmamk6SkZwTklYek5GWUx6bWw2emlaRTVCSzZETmxoanBCOHEwNHdVbXh5elJWb0k4cjdiMVJKYmVFcnpDbm9hQ2l6bw==';
    console.log(`🔑 Using API key: ${apiKey.substring(0, 20)}...`);
    const audioProcessor = new SimpleAudioProcessor(apiKey, ws);
    
    audioProcessors.set(connectionId, audioProcessor);
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            
            if (message.type === 'audio_chunk' && message.audio_data) {
                // Process audio chunk
                audioProcessor.addAudioChunk(message.audio_data);
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