import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from 'react';
import type {
  AppState,
  ChatMessage,
  Flashcard,
  Language,
  ConnectionStatus,
  AudioStreamData,
  FeedbackGeneratedPayload,
} from '../types';
import { Storage } from '../services/Storage';
import { WebSocketClient } from '../services/WebSocketClient';
import { AudioHandler } from '../services/AudioHandler';
import { AudioPlayer } from '../services/AudioPlayer';

// Helper to determine WebSocket URL for Cloud Run deployment
const getWebSocketUrl = (): string => {
  const backendUrl = import.meta.env.VITE_BACKEND_URL;
  if (backendUrl) {
    // Convert https:// to wss:// or http:// to ws://
    return backendUrl.replace(/^http/, 'ws');
  }
  // Local development: use same host with port 3000
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.hostname}:3000`;
};

// Helper for API URL for Cloud Run deployment
const getApiUrl = (path: string): string => {
  const backendUrl = import.meta.env.VITE_BACKEND_URL;
  return backendUrl ? `${backendUrl}${path}` : path;
};

// Action types
type AppAction =
  | { type: 'SET_CONNECTION_STATUS'; payload: ConnectionStatus }
  | { type: 'SET_LANGUAGE'; payload: string }
  | { type: 'SET_AVAILABLE_LANGUAGES'; payload: Language[] }
  | { type: 'SET_CHAT_HISTORY'; payload: ChatMessage[] }
  | { type: 'ADD_MESSAGE'; payload: ChatMessage }
  | { type: 'SET_CURRENT_TRANSCRIPT'; payload: string }
  | { type: 'SET_PENDING_TRANSCRIPTION'; payload: string | null }
  | { type: 'SET_STREAMING_LLM_RESPONSE'; payload: string }
  | { type: 'APPEND_LLM_CHUNK'; payload: string }
  | { type: 'SET_LLM_COMPLETE'; payload: boolean }
  | { type: 'SET_RESPONSE_ID'; payload: string | null }
  | { type: 'SET_RECORDING'; payload: boolean }
  | { type: 'SET_SPEECH_DETECTED'; payload: boolean }
  | { type: 'SET_FLASHCARDS'; payload: Flashcard[] }
  | { type: 'ADD_FLASHCARDS'; payload: Flashcard[] }
  | {
      type: 'SET_FEEDBACK';
      payload: { messageContent: string; feedback: string };
    }
  | { type: 'RESET_STREAMING_STATE' }
  | { type: 'RESET_CONVERSATION' };

// Initial state
const createInitialState = (storage: Storage): AppState => ({
  connectionStatus: 'connecting',
  currentLanguage: storage.getLanguage(),
  availableLanguages: [],
  chatHistory: [],
  currentTranscript: '',
  pendingTranscription: null,
  streamingLLMResponse: '',
  llmResponseComplete: false,
  currentResponseId: null,
  isRecording: false,
  speechDetected: false,
  flashcards: [],
  feedbackMap: {},
  userId: storage.getOrCreateUserId(),
});

// Reducer
function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_CONNECTION_STATUS':
      return { ...state, connectionStatus: action.payload };
    case 'SET_LANGUAGE':
      return { ...state, currentLanguage: action.payload };
    case 'SET_AVAILABLE_LANGUAGES':
      return { ...state, availableLanguages: action.payload };
    case 'SET_CHAT_HISTORY':
      return { ...state, chatHistory: action.payload };
    case 'ADD_MESSAGE':
      return { ...state, chatHistory: [...state.chatHistory, action.payload] };
    case 'SET_CURRENT_TRANSCRIPT':
      return { ...state, currentTranscript: action.payload };
    case 'SET_PENDING_TRANSCRIPTION':
      return { ...state, pendingTranscription: action.payload };
    case 'SET_STREAMING_LLM_RESPONSE':
      return { ...state, streamingLLMResponse: action.payload };
    case 'APPEND_LLM_CHUNK':
      return {
        ...state,
        streamingLLMResponse: state.streamingLLMResponse + action.payload,
      };
    case 'SET_LLM_COMPLETE':
      return { ...state, llmResponseComplete: action.payload };
    case 'SET_RESPONSE_ID':
      return { ...state, currentResponseId: action.payload };
    case 'SET_RECORDING':
      return { ...state, isRecording: action.payload };
    case 'SET_SPEECH_DETECTED':
      return { ...state, speechDetected: action.payload };
    case 'SET_FLASHCARDS':
      return { ...state, flashcards: action.payload };
    case 'ADD_FLASHCARDS': {
      const existingWords = new Set(
        state.flashcards.map((f) =>
          (f.targetWord || f.spanish || '').toLowerCase()
        )
      );
      const newCards = action.payload.filter(
        (f) =>
          !existingWords.has((f.targetWord || f.spanish || '').toLowerCase())
      );
      return { ...state, flashcards: [...state.flashcards, ...newCards] };
    }
    case 'SET_FEEDBACK':
      return {
        ...state,
        feedbackMap: {
          ...state.feedbackMap,
          [action.payload.messageContent]: action.payload.feedback,
        },
      };
    case 'RESET_STREAMING_STATE':
      return {
        ...state,
        streamingLLMResponse: '',
        llmResponseComplete: false,
        currentResponseId: null,
      };
    case 'RESET_CONVERSATION':
      return {
        ...state,
        chatHistory: [],
        currentTranscript: '',
        pendingTranscription: null,
        streamingLLMResponse: '',
        llmResponseComplete: false,
        currentResponseId: null,
        speechDetected: false,
      };
    default:
      return state;
  }
}

// Context type
interface AppContextType {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
  storage: Storage;
  wsClient: WebSocketClient;
  audioHandler: AudioHandler;
  audioPlayer: AudioPlayer;
  // Actions
  toggleRecording: () => Promise<void>;
  restartConversation: () => void;
  changeLanguage: (newLanguage: string) => void;
  handleInterrupt: () => void;
  sendTextMessage: (text: string) => void;
}

const AppContext = createContext<AppContextType | null>(null);

// Provider
interface AppProviderProps {
  children: ReactNode;
}

export function AppProvider({ children }: AppProviderProps) {
  const storageRef = useRef(new Storage());
  const wsClientRef = useRef(new WebSocketClient(getWebSocketUrl()));
  const audioHandlerRef = useRef(new AudioHandler());
  const audioPlayerRef = useRef(new AudioPlayer());

  const [state, dispatch] = useReducer(
    appReducer,
    storageRef.current,
    createInitialState
  );

  // Refs for tracking state in callbacks
  const stateRef = useRef(state);
  stateRef.current = state;

  const pendingLLMResponseRef = useRef<string | null>(null);
  const lastPendingTranscriptionRef = useRef<string | null>(null);
  // Track the last processed pair to prevent duplicate additions
  const lastProcessedPairRef = useRef<{ user: string; teacher: string } | null>(
    null
  );

  // Refs for callbacks to avoid effect dependency issues
  const handleInterruptRef = useRef<() => void>(() => {});
  const checkAndUpdateConversationRef = useRef<() => void>(() => {});

  // Initialize audio player
  useEffect(() => {
    audioPlayerRef.current.initialize().catch(console.error);
    return () => {
      audioPlayerRef.current.destroy();
    };
  }, []);

  // Load initial state
  useEffect(() => {
    const storage = storageRef.current;
    const flashcards = storage.getFlashcards(state.currentLanguage);
    dispatch({ type: 'SET_FLASHCARDS', payload: flashcards });
  }, [state.currentLanguage]);

  // Fetch available languages
  useEffect(() => {
    const fetchLanguages = async () => {
      try {
        const response = await fetch(getApiUrl('/api/languages'));
        if (response.ok) {
          const data = await response.json();
          dispatch({
            type: 'SET_AVAILABLE_LANGUAGES',
            payload: data.languages,
          });

          const isValidLanguage = data.languages.some(
            (lang: Language) => lang.code === state.currentLanguage
          );
          if (!isValidLanguage) {
            dispatch({
              type: 'SET_LANGUAGE',
              payload: data.defaultLanguage || 'es',
            });
          }
        }
      } catch (error) {
        console.error('Failed to fetch languages:', error);
        dispatch({
          type: 'SET_AVAILABLE_LANGUAGES',
          payload: [
            { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇲🇽' },
          ],
        });
      }
    };
    fetchLanguages();
  }, []);

  // Check and update conversation
  const checkAndUpdateConversation = useCallback(() => {
    const currentState = stateRef.current;
    const pendingTranscription = currentState.pendingTranscription;
    const pendingLLMResponse = pendingLLMResponseRef.current;

    const storage = storageRef.current;
    const wsClient = wsClientRef.current;

    const lastUserMessage = currentState.chatHistory
      .filter((m) => m.role === 'learner')
      .pop();
    const lastTeacherMessage = currentState.chatHistory
      .filter((m) => m.role === 'teacher')
      .pop();

    // Case 1: We have a pending LLM response but user message was already added (text input case)
    if (pendingLLMResponse && !pendingTranscription) {
      // Check if teacher response is already in history
      if (lastTeacherMessage?.content === pendingLLMResponse) {
        pendingLLMResponseRef.current = null;
        dispatch({ type: 'RESET_STREAMING_STATE' });
        return;
      }

      // Add only the teacher response
      storage.addMessage('assistant', pendingLLMResponse);
      dispatch({
        type: 'ADD_MESSAGE',
        payload: { role: 'teacher', content: pendingLLMResponse },
      });

      const conversationHistory = storage.getConversationHistory();
      wsClient.send({ type: 'conversation_update', data: conversationHistory });

      pendingLLMResponseRef.current = null;
      dispatch({ type: 'RESET_STREAMING_STATE' });
      return;
    }

    // Case 2: We have both pending transcription and LLM response (audio input case)
    if (pendingTranscription && pendingLLMResponse) {
      // Check if we've already processed this exact pair (using ref for synchronous check)
      const lastPair = lastProcessedPairRef.current;
      if (
        lastPair &&
        lastPair.user === pendingTranscription &&
        lastPair.teacher === pendingLLMResponse
      ) {
        // Already processed this pair, just clean up
        dispatch({ type: 'SET_PENDING_TRANSCRIPTION', payload: null });
        pendingLLMResponseRef.current = null;
        dispatch({ type: 'RESET_STREAMING_STATE' });
        return;
      }

      const isDuplicate =
        lastUserMessage?.content === pendingTranscription &&
        lastTeacherMessage?.content === pendingLLMResponse;

      if (isDuplicate) {
        lastProcessedPairRef.current = {
          user: pendingTranscription,
          teacher: pendingLLMResponse,
        };
        dispatch({ type: 'SET_PENDING_TRANSCRIPTION', payload: null });
        pendingLLMResponseRef.current = null;
        dispatch({ type: 'RESET_STREAMING_STATE' });
        return;
      }

      const teacherAlreadyAdded =
        lastTeacherMessage?.content === pendingLLMResponse;
      const userAlreadyAdded =
        lastUserMessage?.content === pendingTranscription;

      // Mark this pair as processed BEFORE adding (synchronous protection)
      lastProcessedPairRef.current = {
        user: pendingTranscription,
        teacher: pendingLLMResponse,
      };

      if (teacherAlreadyAdded && !userAlreadyAdded) {
        storage.addMessage('user', pendingTranscription);
        dispatch({
          type: 'ADD_MESSAGE',
          payload: { role: 'learner', content: pendingTranscription },
        });

        const conversationHistory = storage.getConversationHistory();
        wsClient.send({
          type: 'conversation_update',
          data: conversationHistory,
        });

        dispatch({ type: 'SET_PENDING_TRANSCRIPTION', payload: null });
        pendingLLMResponseRef.current = null;
        dispatch({ type: 'RESET_STREAMING_STATE' });
        return;
      }

      // Add user message only if not already added
      if (!userAlreadyAdded) {
        storage.addMessage('user', pendingTranscription);
        dispatch({
          type: 'ADD_MESSAGE',
          payload: { role: 'learner', content: pendingTranscription },
        });
      }

      // Add teacher message only if not already added
      if (!teacherAlreadyAdded) {
        storage.addMessage('assistant', pendingLLMResponse);
        dispatch({
          type: 'ADD_MESSAGE',
          payload: { role: 'teacher', content: pendingLLMResponse },
        });
      }

      const conversationHistory = storage.getConversationHistory();
      wsClient.send({ type: 'conversation_update', data: conversationHistory });

      dispatch({ type: 'SET_PENDING_TRANSCRIPTION', payload: null });
      pendingLLMResponseRef.current = null;
      dispatch({ type: 'RESET_STREAMING_STATE' });
    }
  }, []);

  // Keep refs updated
  checkAndUpdateConversationRef.current = checkAndUpdateConversation;

  // Handle interrupt
  const handleInterrupt = useCallback(() => {
    console.log('[AppContext] Handling interrupt');
    const audioPlayer = audioPlayerRef.current;
    audioPlayer.stop();

    const currentState = stateRef.current;
    if (currentState.streamingLLMResponse?.trim()) {
      const frozenText = currentState.streamingLLMResponse;
      pendingLLMResponseRef.current = frozenText;

      if (currentState.pendingTranscription) {
        checkAndUpdateConversationRef.current();
      } else {
        const lastTeacherMessage = currentState.chatHistory
          .filter((m) => m.role === 'teacher')
          .pop();

        if (lastTeacherMessage?.content !== frozenText) {
          dispatch({
            type: 'ADD_MESSAGE',
            payload: { role: 'teacher', content: frozenText },
          });
        }
      }

      dispatch({ type: 'RESET_STREAMING_STATE' });
    }
  }, []);

  // Keep refs updated
  handleInterruptRef.current = handleInterrupt;

  // Setup WebSocket event listeners - runs once on mount
  useEffect(() => {
    const wsClient = wsClientRef.current;
    const storage = storageRef.current;
    const audioPlayer = audioPlayerRef.current;

    // Clear any existing listeners to prevent duplicates
    wsClient.clearAllListeners();

    wsClient.on('connection', (status) => {
      dispatch({
        type: 'SET_CONNECTION_STATUS',
        payload: status as ConnectionStatus,
      });

      if (status === 'connected') {
        wsClient.send({
          type: 'set_language',
          languageCode: stateRef.current.currentLanguage,
        });

        const existingConversation = storage.getConversationHistory();
        if (existingConversation.messages.length > 0) {
          wsClient.send({
            type: 'conversation_update',
            data: existingConversation,
          });
        }
      }
    });

    wsClient.on('transcript_update', (text) => {
      dispatch({ type: 'SET_CURRENT_TRANSCRIPT', payload: text as string });
      dispatch({ type: 'SET_SPEECH_DETECTED', payload: true });
    });

    wsClient.on('speech_detected', (data) => {
      dispatch({
        type: 'SET_CURRENT_TRANSCRIPT',
        payload: (data as { text?: string })?.text || '',
      });
      dispatch({ type: 'SET_SPEECH_DETECTED', payload: true });
      handleInterruptRef.current();
    });

    wsClient.on('partial_transcript', (data) => {
      const text = (data as { text?: string })?.text;
      if (text) {
        dispatch({ type: 'SET_CURRENT_TRANSCRIPT', payload: text });
        dispatch({ type: 'SET_SPEECH_DETECTED', payload: true });
      }
    });

    wsClient.on('speech_ended', () => {
      if (!stateRef.current.pendingTranscription) {
        dispatch({ type: 'SET_CURRENT_TRANSCRIPT', payload: '' });
        dispatch({ type: 'SET_SPEECH_DETECTED', payload: false });
      }
    });

    wsClient.on('transcription', (data) => {
      const text = (data as { text: string }).text;
      audioPlayer.stop();

      dispatch({ type: 'SET_CURRENT_TRANSCRIPT', payload: '' });
      dispatch({ type: 'SET_SPEECH_DETECTED', payload: false });

      // Check if this transcription was already added (e.g., by sendTextMessage)
      const alreadyAdded = lastPendingTranscriptionRef.current === text;

      if (!alreadyAdded) {
        // Only set pending transcription for audio-based transcriptions
        dispatch({ type: 'SET_PENDING_TRANSCRIPTION', payload: text });
        lastPendingTranscriptionRef.current = text;
      }

      if (
        pendingLLMResponseRef.current &&
        !stateRef.current.streamingLLMResponse
      ) {
        checkAndUpdateConversationRef.current();
      }

      if (
        stateRef.current.streamingLLMResponse?.trim() &&
        stateRef.current.llmResponseComplete &&
        !pendingLLMResponseRef.current
      ) {
        pendingLLMResponseRef.current = stateRef.current.streamingLLMResponse;
        checkAndUpdateConversationRef.current();
      }

      dispatch({ type: 'RESET_STREAMING_STATE' });

      if (!alreadyAdded) {
        checkAndUpdateConversationRef.current();
      }
    });

    wsClient.on('llm_response_chunk', (data) => {
      if (!stateRef.current.llmResponseComplete) {
        dispatch({
          type: 'APPEND_LLM_CHUNK',
          payload: (data as { text: string }).text,
        });
      }
    });

    wsClient.on('llm_response_complete', (data) => {
      const responseId = `response_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      dispatch({ type: 'SET_RESPONSE_ID', payload: responseId });
      dispatch({ type: 'SET_LLM_COMPLETE', payload: true });

      const finalText =
        (data as { text?: string }).text ||
        stateRef.current.streamingLLMResponse;
      dispatch({ type: 'SET_STREAMING_LLM_RESPONSE', payload: finalText });

      // Store the LLM response and trigger conversation update
      pendingLLMResponseRef.current = finalText;
      checkAndUpdateConversationRef.current();
    });

    wsClient.on('audio_stream', (data) => {
      const audioData = data as AudioStreamData;
      audioPlayer.addAudioStream(
        audioData.audio,
        audioData.sampleRate,
        false,
        audioData.audioFormat
      );
    });

    wsClient.on('audio_stream_complete', () => {
      audioPlayer.markStreamComplete();
    });

    wsClient.on('interrupt', (data) => {
      const reason = (data as { reason?: string })?.reason;

      if (reason === 'continuation_detected') {
        // User is continuing their utterance - discard partial response silently
        console.log(
          '[AppContext] Continuation detected - discarding partial response'
        );
        audioPlayer.stop();
        // Don't save the partial response - just reset streaming state
        dispatch({ type: 'RESET_STREAMING_STATE' });
        pendingLLMResponseRef.current = null;
      } else {
        // Normal interrupt (speech_start) - use regular interrupt handling
        handleInterruptRef.current();
      }
    });

    wsClient.on('conversation_rollback', (data) => {
      // Server removed messages due to utterance continuation - sync frontend state
      const { messages, removedCount } = data as {
        messages: Array<{ role: string; content: string }>;
        removedCount: number;
      };
      console.log(
        `[AppContext] Conversation rollback - removed ${removedCount} messages`
      );

      // Convert backend format to frontend format
      const chatHistory = messages.map((m) => ({
        role: m.role === 'user' ? 'learner' : 'teacher',
        content: m.content,
      })) as ChatMessage[];

      // Update chat history to match server state
      dispatch({ type: 'SET_CHAT_HISTORY', payload: chatHistory });

      // Also update storage to stay in sync
      storage.clearConversation();
      messages.forEach((m) => {
        storage.addMessage(m.role === 'user' ? 'user' : 'assistant', m.content);
      });

      // Clear any pending state
      dispatch({ type: 'SET_PENDING_TRANSCRIPTION', payload: null });
      pendingLLMResponseRef.current = null;
      lastPendingTranscriptionRef.current = null;
    });

    wsClient.on('flashcards_generated', (flashcards) => {
      const cards = flashcards as Flashcard[];
      const updatedFlashcards = storage.addFlashcards(
        cards,
        stateRef.current.currentLanguage
      );
      dispatch({ type: 'SET_FLASHCARDS', payload: updatedFlashcards });
    });

    wsClient.on('feedback_generated', (data) => {
      const { messageContent, feedback } = data as FeedbackGeneratedPayload;
      dispatch({ type: 'SET_FEEDBACK', payload: { messageContent, feedback } });
    });

    wsClient.on('language_changed', (data) => {
      console.log(
        `Language changed to ${(data as { languageName: string }).languageName}`
      );
    });

    // Connect
    wsClient.connect().catch((error) => {
      console.error('WebSocket connection failed:', error);
      dispatch({ type: 'SET_CONNECTION_STATUS', payload: 'disconnected' });
    });

    // Cleanup - only runs on unmount
    return () => {
      wsClient.clearAllListeners();
      wsClient.disconnect();
    };
  }, []); // Empty dependency array - only run on mount/unmount

  // Audio chunk handler
  useEffect(() => {
    const audioHandler = audioHandlerRef.current;
    const wsClient = wsClientRef.current;

    const handleAudioChunk = (audioData: string) => {
      wsClient.sendAudioChunk(audioData);
    };

    audioHandler.on('audioChunk', handleAudioChunk);

    return () => {
      audioHandler.off('audioChunk', handleAudioChunk);
    };
  }, []);

  // User context on connect
  useEffect(() => {
    const wsClient = wsClientRef.current;

    if (state.connectionStatus === 'connected') {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
        wsClient.send({
          type: 'user_context',
          timezone: tz,
          userId: state.userId,
          languageCode: state.currentLanguage,
        });
      } catch {
        // ignore
      }
    }
  }, [state.connectionStatus, state.userId, state.currentLanguage]);

  // Toggle recording
  const toggleRecording = useCallback(async () => {
    const audioHandler = audioHandlerRef.current;

    if (!state.isRecording) {
      try {
        await audioHandler.startStreaming();
        dispatch({ type: 'SET_RECORDING', payload: true });
        dispatch({ type: 'SET_CURRENT_TRANSCRIPT', payload: '' });
        dispatch({ type: 'SET_SPEECH_DETECTED', payload: false });
      } catch (error) {
        console.error('Failed to start streaming:', error);
        alert(
          'Microphone access denied. Please enable microphone permissions.'
        );
      }
    } else {
      audioHandler.stopStreaming();
      dispatch({ type: 'SET_RECORDING', payload: false });
      dispatch({ type: 'SET_CURRENT_TRANSCRIPT', payload: '' });
      dispatch({ type: 'SET_SPEECH_DETECTED', payload: false });
    }
  }, [state.isRecording]);

  // Restart conversation
  const restartConversation = useCallback(() => {
    const audioHandler = audioHandlerRef.current;
    const audioPlayer = audioPlayerRef.current;
    const storage = storageRef.current;
    const wsClient = wsClientRef.current;

    if (state.isRecording) {
      audioHandler.stopStreaming();
      dispatch({ type: 'SET_RECORDING', payload: false });
    }

    audioPlayer.stop();
    storage.clearConversation();

    dispatch({ type: 'RESET_CONVERSATION' });
    pendingLLMResponseRef.current = null;
    lastPendingTranscriptionRef.current = null;
    lastProcessedPairRef.current = null;

    storage.saveState({ chatHistory: [] });

    if (state.connectionStatus === 'connected') {
      wsClient.send({ type: 'restart_conversation' });
    }
  }, [state.isRecording, state.connectionStatus]);

  // Change language
  const changeLanguage = useCallback(
    (newLanguage: string) => {
      const audioHandler = audioHandlerRef.current;
      const audioPlayer = audioPlayerRef.current;
      const storage = storageRef.current;
      const wsClient = wsClientRef.current;

      if (state.isRecording) {
        audioHandler.stopStreaming();
        dispatch({ type: 'SET_RECORDING', payload: false });
      }

      audioPlayer.stop();

      dispatch({ type: 'SET_LANGUAGE', payload: newLanguage });
      storage.saveLanguage(newLanguage);

      storage.clearConversation();
      dispatch({ type: 'RESET_CONVERSATION' });
      pendingLLMResponseRef.current = null;
      lastPendingTranscriptionRef.current = null;
      lastProcessedPairRef.current = null;

      const flashcards = storage.getFlashcards(newLanguage);
      dispatch({ type: 'SET_FLASHCARDS', payload: flashcards });

      if (state.connectionStatus === 'connected') {
        wsClient.send({ type: 'set_language', languageCode: newLanguage });
      }
    },
    [state.isRecording, state.connectionStatus]
  );

  // Send text message (bypasses audio/STT)
  const sendTextMessage = useCallback(
    (text: string) => {
      const wsClient = wsClientRef.current;
      const storage = storageRef.current;
      const trimmedText = text.trim();

      if (!trimmedText || state.connectionStatus !== 'connected') return;

      // Add user message to chat history immediately (unlike audio where we wait for transcription)
      storage.addMessage('user', trimmedText);
      dispatch({
        type: 'ADD_MESSAGE',
        payload: { role: 'learner', content: trimmedText },
      });

      // Track this as the last pending transcription so we don't duplicate it
      // when the backend sends back the transcription event
      lastPendingTranscriptionRef.current = trimmedText;

      // Send to backend
      wsClient.send({ type: 'text_message', text: trimmedText });
    },
    [state.connectionStatus]
  );

  const value: AppContextType = {
    state,
    dispatch,
    storage: storageRef.current,
    wsClient: wsClientRef.current,
    audioHandler: audioHandlerRef.current,
    audioPlayer: audioPlayerRef.current,
    toggleRecording,
    restartConversation,
    changeLanguage,
    handleInterrupt,
    sendTextMessage,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
