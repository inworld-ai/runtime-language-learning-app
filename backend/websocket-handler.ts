import { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import {
    ChatMessage,
    Flashcard,
    ClientContext,
    AudioChunkMessage,
    WebSocketMessage,
    TranscriptUpdateMessage,
    AIResponseMessage,
    FlashcardGeneratedMessage,
    ConnectionStatusMessage,
    ErrorMessage
} from './types.js';
import { SileroVAD, VADConfig } from './helpers/silero-vad.js';
import { ConversationGraph, ConversationGraphConfig } from './graphs/conversation-graph.js';

export class WebSocketHandler {
    private connections = new Map<string, WebSocket>();
    private connectionContexts = new Map<string, ClientContext>();
    private vadInstances = new Map<string, SileroVAD>();
    private conversationGraphs = new Map<string, ConversationGraph>();
    
    private vadConfig: VADConfig;
    private graphConfig: ConversationGraphConfig;

    constructor(vadConfig: VADConfig, graphConfig: ConversationGraphConfig) {
        this.vadConfig = vadConfig;
        this.graphConfig = graphConfig;
    }

    async handleConnection(ws: WebSocket) {
        const connectionId = uuidv4();
        this.connections.set(connectionId, ws);
        
        // Initialize empty context for new connection
        this.connectionContexts.set(connectionId, {
            chatHistory: [],
            flashcards: []
        });

        // Initialize VAD instance for this connection
        try {
            const vad = new SileroVAD(this.vadConfig);
            await vad.initialize();
            this.vadInstances.set(connectionId, vad);
            
            // Initialize Conversation Graph for this connection
            const conversationGraph = await ConversationGraph.create(this.graphConfig);
            this.conversationGraphs.set(connectionId, conversationGraph);
            
            // Set up VAD event listeners
            vad.on('speechStart', (event) => {
                console.log(`Speech detected for ${connectionId}`);
                this.sendMessage(connectionId, {
                    type: 'speech_detected',
                    data: { confidence: event.confidence }
                });
            });
            
            vad.on('speechEnd', async (event) => {
                console.log(`Speech ended for ${connectionId}, processing...`);
                await this.processSpeechSegment(connectionId, event.speechSegment);
            });
            
        } catch (error) {
            console.error(`Failed to initialize VAD/Graph for ${connectionId}:`, error);
            this.sendError(connectionId, 'Failed to initialize audio processing');
            return;
        }

        console.log(`WebSocket connection established: ${connectionId}`);

        ws.on('message', (data: Buffer) => {
            try {
                const message: WebSocketMessage = JSON.parse(data.toString());
                this.handleMessage(connectionId, message);
            } catch (error) {
                console.error('Failed to parse WebSocket message:', error);
                this.sendError(connectionId, 'Invalid message format');
            }
        });

        ws.on('close', (code: number, reason: Buffer) => {
            console.log(`WebSocket connection closed: ${connectionId} (${code}: ${reason.toString()})`);
            this.cleanup(connectionId);
        });

        ws.on('error', (error: Error) => {
            console.error(`WebSocket error for ${connectionId}:`, error);
            this.cleanup(connectionId);
        });

        // Send connection confirmation
        this.sendMessage(connectionId, {
            type: 'connection_status',
            data: { status: 'connected' }
        });
    }

    private async handleMessage(connectionId: string, message: WebSocketMessage) {
        console.log(`Received message from ${connectionId}:`, message.type);

        // Update context if provided
        if (message.context) {
            this.connectionContexts.set(connectionId, message.context);
        }

        switch (message.type) {
            case 'audio_chunk':
                await this.handleAudioChunk(connectionId, message as AudioChunkMessage);
                break;
            
            default:
                console.warn(`Unknown message type: ${message.type}`);
                this.sendError(connectionId, `Unknown message type: ${message.type}`);
        }
    }

    private async handleAudioChunk(connectionId: string, message: any) {
        try {
            // Handle continuous streaming audio chunks
            console.log(`Received audio chunk from ${connectionId} (${message.audio_data.length} bytes base64)`);
            
            // TODO: Add to rolling buffer and process with Silero VAD
            // For now, just log that we received it
            await this.processStreamingAudio(connectionId, message.audio_data);

        } catch (error) {
            console.error('Error processing audio chunk:', error);
            this.sendError(connectionId, 'Failed to process audio');
        }
    }

    private async processStreamingAudio(connectionId: string, audioData: string) {
        try {
            const vad = this.vadInstances.get(connectionId);
            if (!vad) {
                console.error(`No VAD instance found for ${connectionId}`);
                return;
            }
            
            // Add audio chunk to VAD for processing
            vad.addAudioData(audioData);
            
        } catch (error) {
            console.error(`Error processing streaming audio for ${connectionId}:`, error);
            this.sendError(connectionId, 'Failed to process audio');
        }
    }
    
    private async processSpeechSegment(connectionId: string, speechSegment: Float32Array) {
        try {
            const conversationGraph = this.conversationGraphs.get(connectionId);
            const context = this.connectionContexts.get(connectionId);
            
            if (!conversationGraph || !context) {
                console.error(`No graph or context found for ${connectionId}`);
                return;
            }
            
            console.log(`Processing speech segment (${speechSegment.length} samples)`);
            
            // Prepare input for conversation graph
            const input = {
                audioSegment: speechSegment,
                sampleRate: this.vadConfig.sampleRate,
                chatHistory: context.chatHistory,
                flashcards: context.flashcards
            };
            
            // Process through conversation graph with transcript callback
            const response = await conversationGraph.processConversation(input, (transcriptText) => {
                // Handle transcript update from reportToClient
                console.log(`Transcript for ${connectionId}: ${transcriptText}`);
                
                // Add learner's message to chat history
                context.chatHistory.push({
                    role: 'learner',
                    content: transcriptText
                });
                
                // Send transcript update to client
                this.sendMessage(connectionId, {
                    type: 'transcript_update',
                    data: { text: transcriptText }
                });
            });
            
            // Add teacher's response to chat history
            context.chatHistory.push({
                role: 'teacher',
                content: response.text
            });
            
            // Send AI response to client
            this.sendMessage(connectionId, {
                type: 'ai_response',
                data: {
                    text: response.text,
                    audio: response.audioData || null
                }
            });
            
        } catch (error) {
            console.error(`Error processing speech segment for ${connectionId}:`, error);
            this.sendError(connectionId, 'Failed to process speech');
        }
    }

    private sendMessage(connectionId: string, message: any) {
        const ws = this.connections.get(connectionId);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }

    private sendError(connectionId: string, error: string) {
        this.sendMessage(connectionId, {
            type: 'error',
            data: { message: error }
        });
    }

    private cleanup(connectionId: string) {
        // Clean up VAD instance
        const vad = this.vadInstances.get(connectionId);
        if (vad) {
            vad.destroy();
            this.vadInstances.delete(connectionId);
        }
        
        // Clean up ConversationGraph instance
        const graph = this.conversationGraphs.get(connectionId);
        if (graph) {
            graph.destroy();
            this.conversationGraphs.delete(connectionId);
        }
        
        this.connections.delete(connectionId);
        this.connectionContexts.delete(connectionId);
        
        console.log(`Cleaned up connection: ${connectionId}`);
    }
}