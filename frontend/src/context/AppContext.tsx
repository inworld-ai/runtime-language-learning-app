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
} from '../types';
import { Storage } from '../services/Storage';
import { WebSocketClient } from '../services/WebSocketClient';
import { AudioHandler } from '../services/AudioHandler';
import { AudioPlayer } from '../services/AudioPlayer';

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
}

const AppContext = createContext<AppContextType | null>(null);

// Provider
interface AppProviderProps {
  children: ReactNode;
}

export function AppProvider({ children }: AppProviderProps) {
  const storageRef = useRef(new Storage());
  const wsClientRef = useRef(
    new WebSocketClient(
      `ws://${window.location.hostname}:3000`
    )
  );
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
        const response = await fetch('/api/languages');
        if (response.ok) {
          const data = await response.json();
          dispatch({ type: 'SET_AVAILABLE_LANGUAGES', payload: data.languages });

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
            { code: 'ja', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵' },
            { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷' },
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

    if (pendingTranscription && pendingLLMResponse) {
      const lastUserMessage = currentState.chatHistory
        .filter((m) => m.role === 'learner')
        .pop();
      const lastTeacherMessage = currentState.chatHistory
        .filter((m) => m.role === 'teacher')
        .pop();

      const isDuplicate =
        lastUserMessage?.content === pendingTranscription &&
        lastTeacherMessage?.content === pendingLLMResponse;

      if (isDuplicate) {
        dispatch({ type: 'SET_PENDING_TRANSCRIPTION', payload: null });
        pendingLLMResponseRef.current = null;
        dispatch({ type: 'RESET_STREAMING_STATE' });
        return;
      }

      const teacherAlreadyAdded = lastTeacherMessage?.content === pendingLLMResponse;
      const userAlreadyAdded = lastUserMessage?.content === pendingTranscription;

      const storage = storageRef.current;
      const wsClient = wsClientRef.current;

      if (teacherAlreadyAdded && !userAlreadyAdded) {
        storage.addMessage('user', pendingTranscription);
        dispatch({
          type: 'ADD_MESSAGE',
          payload: { role: 'learner', content: pendingTranscription },
        });

        const conversationHistory = storage.getConversationHistory();
        wsClient.send({ type: 'conversation_update', data: conversationHistory });

        dispatch({ type: 'SET_PENDING_TRANSCRIPTION', payload: null });
        pendingLLMResponseRef.current = null;
        dispatch({ type: 'RESET_STREAMING_STATE' });
        return;
      }

      storage.addMessage('user', pendingTranscription);
      storage.addMessage('assistant', pendingLLMResponse);

      dispatch({
        type: 'ADD_MESSAGE',
        payload: { role: 'learner', content: pendingTranscription },
      });
      dispatch({
        type: 'ADD_MESSAGE',
        payload: { role: 'teacher', content: pendingLLMResponse },
      });

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
      dispatch({ type: 'SET_CONNECTION_STATUS', payload: status as ConnectionStatus });

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

      dispatch({ type: 'SET_PENDING_TRANSCRIPTION', payload: text });
      dispatch({ type: 'SET_CURRENT_TRANSCRIPT', payload: '' });
      dispatch({ type: 'SET_SPEECH_DETECTED', payload: false });

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

      if (lastPendingTranscriptionRef.current !== text) {
        lastPendingTranscriptionRef.current = text;
      }

      checkAndUpdateConversationRef.current();
    });

    wsClient.on('llm_response_chunk', (data) => {
      if (!stateRef.current.llmResponseComplete) {
        dispatch({ type: 'APPEND_LLM_CHUNK', payload: (data as { text: string }).text });
      }
    });

    wsClient.on('llm_response_complete', (data) => {
      const responseId = `response_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      dispatch({ type: 'SET_RESPONSE_ID', payload: responseId });
      dispatch({ type: 'SET_LLM_COMPLETE', payload: true });

      const finalText =
        (data as { text?: string }).text || stateRef.current.streamingLLMResponse;
      dispatch({ type: 'SET_STREAMING_LLM_RESPONSE', payload: finalText });
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

    wsClient.on('interrupt', () => {
      handleInterruptRef.current();
    });

    wsClient.on('flashcards_generated', (flashcards) => {
      const cards = flashcards as Flashcard[];
      const updatedFlashcards = storage.addFlashcards(
        cards,
        stateRef.current.currentLanguage
      );
      dispatch({ type: 'SET_FLASHCARDS', payload: updatedFlashcards });
    });

    wsClient.on('language_changed', (data) => {
      console.log(`Language changed to ${(data as { languageName: string }).languageName}`);
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
        alert('Microphone access denied. Please enable microphone permissions.');
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

      const flashcards = storage.getFlashcards(newLanguage);
      dispatch({ type: 'SET_FLASHCARDS', payload: flashcards });

      if (state.connectionStatus === 'connected') {
        wsClient.send({ type: 'set_language', languageCode: newLanguage });
      }
    },
    [state.isRecording, state.connectionStatus]
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
