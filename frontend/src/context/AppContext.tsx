import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useRef,
  useCallback,
  useMemo,
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
  ConversationSummary,
} from '../types';
import { HybridStorage } from '../services/HybridStorage';
import { WebSocketClient } from '../services/WebSocketClient';
import { AudioHandler } from '../services/AudioHandler';
import { AudioPlayer } from '../services/AudioPlayer';
import { useAuth } from './AuthContext';

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
  | { type: 'SET_PRONOUNCING_CARD_ID'; payload: string | null }
  | {
      type: 'SET_FEEDBACK';
      payload: { messageContent: string; feedback: string };
    }
  | { type: 'RESET_STREAMING_STATE' }
  | { type: 'RESET_CONVERSATION' }
  | { type: 'SET_CONVERSATIONS'; payload: ConversationSummary[] }
  | { type: 'SET_CURRENT_CONVERSATION_ID'; payload: string | null }
  | { type: 'SET_SIDEBAR_OPEN'; payload: boolean }
  | { type: 'ADD_CONVERSATION'; payload: ConversationSummary }
  | { type: 'REMOVE_CONVERSATION'; payload: string }
  | { type: 'RENAME_CONVERSATION'; payload: { id: string; title: string } }
  | { type: 'SET_USER_ID'; payload: string | null };

// Initial state
const createInitialState = (storage: HybridStorage): AppState => ({
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
  pronouncingCardId: null,
  feedbackMap: {},
  userId: null,
  conversations: [],
  currentConversationId: null,
  sidebarOpen: false,
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
    case 'SET_PRONOUNCING_CARD_ID':
      return { ...state, pronouncingCardId: action.payload };
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
    case 'SET_CONVERSATIONS':
      return { ...state, conversations: action.payload };
    case 'SET_CURRENT_CONVERSATION_ID':
      return { ...state, currentConversationId: action.payload };
    case 'SET_SIDEBAR_OPEN':
      return { ...state, sidebarOpen: action.payload };
    case 'ADD_CONVERSATION':
      return {
        ...state,
        conversations: [action.payload, ...state.conversations],
      };
    case 'REMOVE_CONVERSATION':
      return {
        ...state,
        conversations: state.conversations.filter(
          (c) => c.id !== action.payload
        ),
      };
    case 'RENAME_CONVERSATION':
      return {
        ...state,
        conversations: state.conversations.map((c) =>
          c.id === action.payload.id
            ? {
                ...c,
                title: action.payload.title,
                updatedAt: new Date().toISOString(),
              }
            : c
        ),
      };
    case 'SET_USER_ID':
      return { ...state, userId: action.payload };
    default:
      return state;
  }
}

// Context type
interface AppContextType {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
  storage: HybridStorage;
  wsClient: WebSocketClient;
  audioHandler: AudioHandler;
  audioPlayer: AudioPlayer;
  // Actions
  toggleRecording: () => Promise<void>;
  changeLanguage: (newLanguage: string) => void;
  handleInterrupt: () => void;
  sendTextMessage: (text: string) => void;
  pronounceWord: (text: string) => void;
  // Conversation actions
  selectConversation: (conversationId: string) => void;
  createNewConversation: () => void;
  deleteConversation: (conversationId: string) => void;
  renameConversation: (conversationId: string, newTitle: string) => void;
  toggleSidebar: () => void;
}

const AppContext = createContext<AppContextType | null>(null);

// Provider
interface AppProviderProps {
  children: ReactNode;
}

export function AppProvider({ children }: AppProviderProps) {
  const { supabase, user } = useAuth();
  // Create instances directly using useMemo - these are stable and don't change
  const storageInstance = useMemo(() => new HybridStorage(), []);
  const storageRef = useRef(storageInstance);
  const wsClientInstance = useMemo(
    () => new WebSocketClient(getWebSocketUrl()),
    []
  );
  const wsClientRef = useRef(wsClientInstance);
  const audioHandlerInstance = useMemo(() => new AudioHandler(), []);
  const audioHandlerRef = useRef(audioHandlerInstance);
  const audioPlayerInstance = useMemo(() => new AudioPlayer(), []);
  const audioPlayerRef = useRef(audioPlayerInstance);
  const ttsAudioPlayerInstance = useMemo(() => new AudioPlayer(), []);
  const ttsAudioPlayerRef = useRef(ttsAudioPlayerInstance);
  const hasMigratedRef = useRef(false);

  const [state, dispatch] = useReducer(
    appReducer,
    storageInstance,
    createInitialState
  );

  // Refs for tracking state in callbacks
  const stateRef = useRef(state);

  // Update stateRef in effect to avoid updating ref during render
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Connect/disconnect Supabase based on auth state
  useEffect(() => {
    const storage = storageRef.current;

    if (supabase && user) {
      // Immediately update userId from auth
      dispatch({ type: 'SET_USER_ID', payload: user.id });

      storage.setSupabaseClient(supabase, user.id);

      // Sync data on login
      if (!hasMigratedRef.current) {
        hasMigratedRef.current = true;
        const languages = stateRef.current.availableLanguages.map(
          (l) => l.code
        );
        const langsToSync =
          languages.length > 0 ? languages : [stateRef.current.currentLanguage];

        // First try to sync ALL conversations FROM Supabase (existing user on new device)
        // Then migrate any local data TO Supabase
        storage
          .syncAllConversationsFromSupabase()
          .then((allConversations) => {
            // If user has conversations in Supabase, reload the UI state with ALL of them
            if (allConversations.length > 0) {
              dispatch({
                type: 'SET_CONVERSATIONS',
                payload: allConversations,
              });
              // Load the most recent conversation
              const mostRecent = allConversations[0];
              dispatch({
                type: 'SET_CURRENT_CONVERSATION_ID',
                payload: mostRecent.id,
              });
              // Update language to match the most recent conversation
              if (
                mostRecent.languageCode !== stateRef.current.currentLanguage
              ) {
                dispatch({
                  type: 'SET_LANGUAGE',
                  payload: mostRecent.languageCode,
                });
                storage.saveLanguage(mostRecent.languageCode);
              }
              const convData = storage.getConversation(mostRecent.id);
              if (convData) {
                const chatHistory = convData.messages.map((m) => ({
                  role: m.role === 'user' ? 'learner' : 'teacher',
                  content: m.content,
                })) as ChatMessage[];
                dispatch({ type: 'SET_CHAT_HISTORY', payload: chatHistory });
              }
              // Load flashcards for the most recent conversation
              const flashcards = storage.getFlashcardsForConversation(
                mostRecent.id
              );
              dispatch({ type: 'SET_FLASHCARDS', payload: flashcards });
            }
            // Also migrate any local data that isn't in Supabase yet
            return storage.migrateToSupabase(langsToSync);
          })
          .catch(console.error);
      }
    } else {
      // Clear userId on logout
      dispatch({ type: 'SET_USER_ID', payload: null });

      storage.clearSupabaseClient();
      hasMigratedRef.current = false;
    }
  }, [supabase, user]);

  const pendingLLMResponseRef = useRef<string | null>(null);
  // Track if the last message was sent via text input (vs audio)
  // This allows us to ignore transcription events for text messages
  const lastMessageWasTextRef = useRef<boolean>(false);
  // Queue flashcards when conversation doesn't exist yet (race condition fix)
  const pendingFlashcardsRef = useRef<Flashcard[]>([]);

  // Refs for callbacks to avoid effect dependency issues
  const handleInterruptRef = useRef<() => void>(() => {});
  const checkAndUpdateConversationRef = useRef<() => void>(() => {});
  const processPendingFlashcardsRef = useRef<(conversationId: string) => void>(
    () => {}
  );

  // Initialize audio players
  useEffect(() => {
    const audioPlayer = audioPlayerRef.current;
    const ttsAudioPlayer = ttsAudioPlayerRef.current;
    audioPlayer.initialize().catch(console.error);
    ttsAudioPlayer.initialize().catch(console.error);
    return () => {
      audioPlayer.destroy();
      ttsAudioPlayer.destroy();
    };
  }, []);

  // Load initial state (conversations across all languages)
  useEffect(() => {
    const storage = storageRef.current;
    const currentLang = stateRef.current.currentLanguage;

    // Load ALL conversations across all languages
    const allConversations = storage.getAllConversations();
    dispatch({ type: 'SET_CONVERSATIONS', payload: allConversations });

    // Load current conversation or use the most recent one
    let currentId = storage.getCurrentConversationId(currentLang);
    if (!currentId && allConversations.length > 0) {
      currentId = allConversations[0].id;
      // Update language to match the most recent conversation
      const mostRecentConvo = allConversations[0];
      if (mostRecentConvo.languageCode !== currentLang) {
        dispatch({
          type: 'SET_LANGUAGE',
          payload: mostRecentConvo.languageCode,
        });
        storage.saveLanguage(mostRecentConvo.languageCode);
      }
      storage.setCurrentConversationId(mostRecentConvo.languageCode, currentId);
    }

    if (currentId) {
      dispatch({ type: 'SET_CURRENT_CONVERSATION_ID', payload: currentId });
      const conversationData = storage.getConversation(currentId);
      if (conversationData) {
        // Convert backend format to UI format
        const chatHistory = conversationData.messages.map((m) => ({
          role: m.role === 'user' ? 'learner' : 'teacher',
          content: m.content,
        })) as ChatMessage[];
        dispatch({ type: 'SET_CHAT_HISTORY', payload: chatHistory });

        // Load flashcards for this specific conversation
        const flashcards = storage.getFlashcardsForConversation(currentId);
        dispatch({ type: 'SET_FLASHCARDS', payload: flashcards });
      }
    } else {
      // No conversations yet - clear flashcards
      dispatch({ type: 'SET_FLASHCARDS', payload: [] });
    }
  }, []); // Run only once on mount

  // Save chat history to current conversation when it changes
  useEffect(() => {
    const storage = storageRef.current;
    const currentId = stateRef.current.currentConversationId;
    const currentLang = stateRef.current.currentLanguage;

    if (currentId && state.chatHistory.length > 0) {
      const messages = state.chatHistory.map((m) => ({
        role: m.role === 'learner' ? 'user' : 'assistant',
        content: m.content,
        timestamp: new Date().toISOString(),
      })) as import('../types').ConversationMessage[];
      storage.saveConversation(currentId, messages, currentLang);
    }
  }, [state.chatHistory]);

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

          const currentLang = stateRef.current.currentLanguage;
          const isValidLanguage = data.languages.some(
            (lang: Language) => lang.code === currentLang
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

    // Track conversation info (may be newly created or from state)
    let conversationId = currentState.currentConversationId;
    let conversationTitle: string | null = null;

    // Auto-create conversation if none exists and we're about to add messages
    if (!conversationId && (pendingTranscription || pendingLLMResponse)) {
      const newConversation = storage.createConversation(
        currentState.currentLanguage
      );
      conversationId = newConversation.id;
      conversationTitle = newConversation.title;
      dispatch({ type: 'ADD_CONVERSATION', payload: newConversation });
      dispatch({
        type: 'SET_CURRENT_CONVERSATION_ID',
        payload: newConversation.id,
      });
      storage.setCurrentConversationId(
        currentState.currentLanguage,
        newConversation.id
      );
      // Process any flashcards that arrived before conversation was created
      processPendingFlashcardsRef.current(newConversation.id);
    } else if (conversationId) {
      // Get title from existing conversation in state
      const currentConvo = currentState.conversations.find(
        (c) => c.id === conversationId
      );
      conversationTitle = currentConvo?.title || null;
    }

    // Case 1: We have a pending LLM response but user message was already added (text input case)
    if (pendingLLMResponse && !pendingTranscription) {
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
      // Auto-rename conversation on first user message (if still has default name)
      if (
        conversationId &&
        conversationTitle &&
        /^Chat \d{5}$/.test(conversationTitle)
      ) {
        const newTitle =
          pendingTranscription.length > 10
            ? pendingTranscription.slice(0, 10) + '...'
            : pendingTranscription;
        storage.renameConversation(
          conversationId,
          newTitle,
          currentState.currentLanguage
        );
        dispatch({
          type: 'RENAME_CONVERSATION',
          payload: { id: conversationId, title: newTitle },
        });
      }

      storage.addMessage('user', pendingTranscription);
      dispatch({
        type: 'ADD_MESSAGE',
        payload: { role: 'learner', content: pendingTranscription },
      });

      storage.addMessage('assistant', pendingLLMResponse);
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

  // Update refs in effect to avoid updating during render
  useEffect(() => {
    checkAndUpdateConversationRef.current = checkAndUpdateConversation;
  }, [checkAndUpdateConversation]);

  // Process any pending flashcards that were queued before conversation existed
  const processPendingFlashcards = useCallback((conversationId: string) => {
    const storage = storageRef.current;
    const pending = pendingFlashcardsRef.current;

    if (pending.length > 0) {
      console.log(
        `[AppContext] Processing ${pending.length} pending flashcards for conversation ${conversationId}`
      );
      const updatedFlashcards = storage.addFlashcardsForConversation(
        conversationId,
        pending,
        stateRef.current.currentLanguage
      );
      dispatch({ type: 'SET_FLASHCARDS', payload: updatedFlashcards });
      pendingFlashcardsRef.current = [];
    }
  }, []);

  // Update refs in effect to avoid updating during render
  useEffect(() => {
    processPendingFlashcardsRef.current = processPendingFlashcards;
  }, [processPendingFlashcards]);

  // Process pending flashcards when conversation ID becomes available
  // This handles the race condition where flashcards arrive before the conversation is created
  useEffect(() => {
    if (
      state.currentConversationId &&
      pendingFlashcardsRef.current.length > 0
    ) {
      processPendingFlashcards(state.currentConversationId);
    }
  }, [state.currentConversationId, processPendingFlashcards]);

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

  // Update refs in effect to avoid updating during render
  useEffect(() => {
    handleInterruptRef.current = handleInterrupt;
  }, [handleInterrupt]);

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

      // If the last message was sent via text input, ignore this transcription event
      // because the user message was already added in sendTextMessage
      if (lastMessageWasTextRef.current) {
        lastMessageWasTextRef.current = false;
        // Still need to check for LLM response and update conversation
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
        checkAndUpdateConversationRef.current();
        return;
      }

      // This is an audio-based transcription - set pending transcription
      dispatch({ type: 'SET_PENDING_TRANSCRIPTION', payload: text });

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
      checkAndUpdateConversationRef.current();
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

    // TTS pronunciation handlers (for flashcard pronunciation)
    const ttsAudioPlayer = ttsAudioPlayerRef.current;
    wsClient.on('tts_pronounce_audio', (data) => {
      const audioData = data as {
        audio: string;
        audioFormat: string;
        sampleRate: number;
      };
      ttsAudioPlayer.addAudioStream(
        audioData.audio,
        audioData.sampleRate,
        false,
        audioData.audioFormat as 'int16' | 'float32'
      );
    });

    wsClient.on('tts_pronounce_complete', () => {
      dispatch({ type: 'SET_PRONOUNCING_CARD_ID', payload: null });
    });

    wsClient.on('tts_pronounce_error', () => {
      dispatch({ type: 'SET_PRONOUNCING_CARD_ID', payload: null });
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
    });

    wsClient.on('flashcards_generated', (flashcards) => {
      const cards = flashcards as Flashcard[];
      const currentConvoId = stateRef.current.currentConversationId;
      if (currentConvoId) {
        // Conversation exists - store flashcards immediately
        const updatedFlashcards = storage.addFlashcardsForConversation(
          currentConvoId,
          cards,
          stateRef.current.currentLanguage
        );
        dispatch({ type: 'SET_FLASHCARDS', payload: updatedFlashcards });
      } else {
        // No conversation yet - queue flashcards for later processing
        console.log(
          `[AppContext] Queuing ${cards.length} flashcards (no conversation yet)`
        );
        pendingFlashcardsRef.current = [
          ...pendingFlashcardsRef.current,
          ...cards,
        ];
      }
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
          // Use auth user ID - will be null if not authenticated
          userId: user?.id || null,
          languageCode: state.currentLanguage,
        });
      } catch {
        // ignore
      }
    }
  }, [state.connectionStatus, user, state.currentLanguage]);

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

  // Change language (only changes the current language for new conversations)
  const changeLanguage = useCallback((newLanguage: string) => {
    const storage = storageRef.current;

    dispatch({ type: 'SET_LANGUAGE', payload: newLanguage });
    storage.saveLanguage(newLanguage);
  }, []);

  // Send text message (bypasses audio/STT)
  const sendTextMessage = useCallback(
    (text: string) => {
      const wsClient = wsClientRef.current;
      const storage = storageRef.current;
      const trimmedText = text.trim();

      if (!trimmedText || state.connectionStatus !== 'connected') return;

      let conversationId = stateRef.current.currentConversationId;
      let conversationTitle: string | null = null;

      // Auto-create conversation if none exists
      if (!conversationId) {
        const newConversation = storage.createConversation(
          stateRef.current.currentLanguage
        );
        conversationId = newConversation.id;
        conversationTitle = newConversation.title;
        dispatch({ type: 'ADD_CONVERSATION', payload: newConversation });
        dispatch({
          type: 'SET_CURRENT_CONVERSATION_ID',
          payload: newConversation.id,
        });
        storage.setCurrentConversationId(
          stateRef.current.currentLanguage,
          newConversation.id
        );
        // Process any flashcards that arrived before conversation was created
        processPendingFlashcardsRef.current(newConversation.id);
      } else {
        // Get title from existing conversation in state
        const currentConvo = stateRef.current.conversations.find(
          (c) => c.id === conversationId
        );
        conversationTitle = currentConvo?.title || null;
      }

      // Auto-rename conversation on first user message (if still has default name)
      if (
        conversationId &&
        conversationTitle &&
        /^Chat \d{5}$/.test(conversationTitle)
      ) {
        const newTitle =
          trimmedText.length > 10
            ? trimmedText.slice(0, 10) + '...'
            : trimmedText;
        storage.renameConversation(
          conversationId,
          newTitle,
          stateRef.current.currentLanguage
        );
        dispatch({
          type: 'RENAME_CONVERSATION',
          payload: { id: conversationId, title: newTitle },
        });
      }

      // Add user message to chat history immediately (unlike audio where we wait for transcription)
      storage.addMessage('user', trimmedText);
      dispatch({
        type: 'ADD_MESSAGE',
        payload: { role: 'learner', content: trimmedText },
      });

      // Flag that this was a text message so we can ignore the transcription event
      lastMessageWasTextRef.current = true;

      // Send to backend
      wsClient.send({ type: 'text_message', text: trimmedText });
    },
    [state.connectionStatus]
  );

  // Pronounce a word using TTS (for flashcard pronunciation)
  const pronounceWord = useCallback(
    (text: string) => {
      const wsClient = wsClientRef.current;
      const ttsAudioPlayer = ttsAudioPlayerRef.current;
      const trimmedText = text.trim();

      if (state.connectionStatus !== 'connected' || !trimmedText) return;

      // Stop any currently playing TTS audio
      ttsAudioPlayer.stop();

      // Use the text itself as the card ID for tracking
      dispatch({ type: 'SET_PRONOUNCING_CARD_ID', payload: trimmedText });
      wsClient.send({
        type: 'tts_pronounce_request',
        text: trimmedText,
        languageCode: state.currentLanguage,
      });
    },
    [state.connectionStatus, state.currentLanguage]
  );

  // Select a conversation from the sidebar
  const selectConversation = useCallback(
    (conversationId: string) => {
      const storage = storageRef.current;
      const audioHandler = audioHandlerRef.current;
      const audioPlayer = audioPlayerRef.current;
      const ttsAudioPlayer = ttsAudioPlayerRef.current;
      const wsClient = wsClientRef.current;

      // Stop any ongoing recording/playback and audio
      if (state.isRecording) {
        audioHandler.stopStreaming();
        dispatch({ type: 'SET_RECORDING', payload: false });
      }
      // Stop main audio playback (TTS responses)
      audioPlayer.stop();
      // Stop TTS audio playback (flashcard pronunciation)
      ttsAudioPlayer.stop();

      // Save current conversation first if it exists
      if (
        state.currentConversationId &&
        stateRef.current.chatHistory.length > 0
      ) {
        const messages = stateRef.current.chatHistory.map((m) => ({
          role: m.role === 'learner' ? 'user' : 'assistant',
          content: m.content,
          timestamp: new Date().toISOString(),
        })) as import('../types').ConversationMessage[];
        storage.saveConversation(
          state.currentConversationId,
          messages,
          state.currentLanguage
        );
      }

      // Find the conversation to get its language
      const conversation = stateRef.current.conversations.find(
        (c) => c.id === conversationId
      );
      const targetLanguage =
        conversation?.languageCode || state.currentLanguage;

      // Switch language if different
      if (targetLanguage !== state.currentLanguage) {
        dispatch({ type: 'SET_LANGUAGE', payload: targetLanguage });
        storage.saveLanguage(targetLanguage);
        if (state.connectionStatus === 'connected') {
          wsClient.send({ type: 'set_language', languageCode: targetLanguage });
        }
      }

      // Load the selected conversation
      const conversationData = storage.getConversation(conversationId);
      if (conversationData) {
        const chatHistory = conversationData.messages.map((m) => ({
          role: m.role === 'user' ? 'learner' : 'teacher',
          content: m.content,
        })) as ChatMessage[];
        dispatch({ type: 'SET_CHAT_HISTORY', payload: chatHistory });
      } else {
        dispatch({ type: 'SET_CHAT_HISTORY', payload: [] });
      }

      dispatch({
        type: 'SET_CURRENT_CONVERSATION_ID',
        payload: conversationId,
      });
      storage.setCurrentConversationId(targetLanguage, conversationId);

      // Load flashcards for this specific conversation
      const flashcards = storage.getFlashcardsForConversation(conversationId);
      dispatch({ type: 'SET_FLASHCARDS', payload: flashcards });

      // Reset streaming state and clear pending flashcards (they belong to old conversation)
      dispatch({ type: 'RESET_STREAMING_STATE' });
      pendingLLMResponseRef.current = null;
      lastMessageWasTextRef.current = false;
      pendingFlashcardsRef.current = [];

      // Update the WebSocket with the loaded conversation
      if (state.connectionStatus === 'connected') {
        wsClient.send({ type: 'conversation_context_reset' });
        if (conversationData && conversationData.messages.length > 0) {
          wsClient.send({
            type: 'conversation_update',
            data: { messages: conversationData.messages },
          });
        }
      }

      // Close sidebar on mobile
      dispatch({ type: 'SET_SIDEBAR_OPEN', payload: false });
    },
    [
      state.isRecording,
      state.currentConversationId,
      state.currentLanguage,
      state.connectionStatus,
    ]
  );

  // Create a new conversation
  const createNewConversation = useCallback(() => {
    const storage = storageRef.current;
    const audioHandler = audioHandlerRef.current;
    const audioPlayer = audioPlayerRef.current;
    const ttsAudioPlayer = ttsAudioPlayerRef.current;
    const wsClient = wsClientRef.current;

    // Stop any ongoing recording/playback and audio
    if (state.isRecording) {
      audioHandler.stopStreaming();
      dispatch({ type: 'SET_RECORDING', payload: false });
    }
    // Stop main audio playback (TTS responses)
    audioPlayer.stop();
    // Stop TTS audio playback (flashcard pronunciation)
    ttsAudioPlayer.stop();

    // Save current conversation first if it exists
    if (
      state.currentConversationId &&
      stateRef.current.chatHistory.length > 0
    ) {
      const messages = stateRef.current.chatHistory.map((m) => ({
        role: m.role === 'learner' ? 'user' : 'assistant',
        content: m.content,
        timestamp: new Date().toISOString(),
      })) as import('../types').ConversationMessage[];
      storage.saveConversation(
        state.currentConversationId,
        messages,
        state.currentLanguage
      );
    }

    // Create new conversation with the current language preference
    // Use state.currentLanguage directly since it's in the dependencies and will be up-to-date
    const languageForNewConversation = state.currentLanguage;
    const newConversation = storage.createConversation(
      languageForNewConversation
    );
    dispatch({ type: 'ADD_CONVERSATION', payload: newConversation });
    dispatch({
      type: 'SET_CURRENT_CONVERSATION_ID',
      payload: newConversation.id,
    });
    storage.setCurrentConversationId(
      languageForNewConversation,
      newConversation.id
    );

    // Clear chat and flashcards (new conversation has no flashcards)
    dispatch({ type: 'RESET_CONVERSATION' });
    dispatch({ type: 'SET_FLASHCARDS', payload: [] });
    pendingLLMResponseRef.current = null;
    lastMessageWasTextRef.current = false;
    pendingFlashcardsRef.current = [];

    // Reset and set language for new conversation
    // We need to reset first, then set language to ensure the conversation starts fresh
    // Even if the language is the same, we want to reset the conversation state
    if (state.connectionStatus === 'connected') {
      // Reset the conversation context first
      wsClient.send({ type: 'conversation_context_reset' });
      // Then set the language (this will also reset, but ensures language is correct)
      wsClient.send({
        type: 'set_language',
        languageCode: languageForNewConversation,
      });
    }

    // Close sidebar on mobile
    dispatch({ type: 'SET_SIDEBAR_OPEN', payload: false });
  }, [
    state.isRecording,
    state.currentConversationId,
    state.currentLanguage,
    state.connectionStatus,
  ]);

  // Delete a conversation
  const deleteConversation = useCallback(
    (conversationId: string) => {
      const storage = storageRef.current;

      // Find the conversation to get its language code
      const conversation = stateRef.current.conversations.find(
        (c) => c.id === conversationId
      );
      const languageCode = conversation?.languageCode || state.currentLanguage;

      storage.deleteConversation(conversationId, languageCode);
      storage.clearFlashcardsForConversation(conversationId);
      dispatch({ type: 'REMOVE_CONVERSATION', payload: conversationId });

      // If we deleted the current conversation, switch to another or create new
      if (state.currentConversationId === conversationId) {
        const remainingConversations = stateRef.current.conversations.filter(
          (c) => c.id !== conversationId
        );

        if (remainingConversations.length > 0) {
          selectConversation(remainingConversations[0].id);
        } else {
          createNewConversation();
        }
      }
    },
    [
      state.currentLanguage,
      state.currentConversationId,
      selectConversation,
      createNewConversation,
    ]
  );

  // Rename a conversation
  const renameConversation = useCallback(
    (conversationId: string, newTitle: string) => {
      const storage = storageRef.current;
      const trimmedTitle = newTitle.trim();
      if (!trimmedTitle) return;

      // Find the conversation to get its language code
      const conversation = stateRef.current.conversations.find(
        (c) => c.id === conversationId
      );
      const languageCode = conversation?.languageCode || state.currentLanguage;

      storage.renameConversation(conversationId, trimmedTitle, languageCode);
      dispatch({
        type: 'RENAME_CONVERSATION',
        payload: { id: conversationId, title: trimmedTitle },
      });
    },
    [state.currentLanguage]
  );

  // Toggle sidebar
  const toggleSidebar = useCallback(() => {
    dispatch({
      type: 'SET_SIDEBAR_OPEN',
      payload: !stateRef.current.sidebarOpen,
    });
  }, []);

  // Use direct instances instead of refs for context value
  // These instances are stable and don't change, so accessing them during render is safe
  const value: AppContextType = useMemo(
    () => ({
      state,
      dispatch,
      storage: storageInstance,
      wsClient: wsClientInstance,
      audioHandler: audioHandlerInstance,
      audioPlayer: audioPlayerInstance,
      toggleRecording,
      changeLanguage,
      handleInterrupt,
      sendTextMessage,
      pronounceWord,
      selectConversation,
      createNewConversation,
      deleteConversation,
      renameConversation,
      toggleSidebar,
    }),
    [
      state,
      dispatch,
      storageInstance,
      wsClientInstance,
      audioHandlerInstance,
      audioPlayerInstance,
      toggleRecording,
      changeLanguage,
      handleInterrupt,
      sendTextMessage,
      pronounceWord,
      selectConversation,
      createNewConversation,
      deleteConversation,
      renameConversation,
      toggleSidebar,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
