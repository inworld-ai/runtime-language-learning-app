export interface ChatMessage {
    role: 'learner' | 'teacher';
    content: string;
}

export interface Flashcard {
    word: string;
    translation: string;
    example_sentence: string;
    mnemonic: string;
}

export interface ClientContext {
    chatHistory: ChatMessage[];
    flashcards: Flashcard[];
}

export interface AudioChunkMessage {
    type: 'audio_chunk';
    data: string; // base64 encoded audio
    context: ClientContext;
}

export interface WebSocketMessage {
    type: string;
    data: any;
    context?: ClientContext;
}

export interface TranscriptUpdateMessage {
    type: 'transcript_update';
    data: {
        text: string;
    };
}

export interface AIResponseMessage {
    type: 'ai_response';
    data: {
        text: string;
        audio: string | null; // base64 encoded audio
    };
}

export interface FlashcardGeneratedMessage {
    type: 'flashcard_generated';
    data: Flashcard;
}

export interface ConnectionStatusMessage {
    type: 'connection_status';
    data: {
        status: 'connected' | 'disconnected' | 'connecting';
    };
}

export interface ErrorMessage {
    type: 'error';
    data: {
        message: string;
    };
}