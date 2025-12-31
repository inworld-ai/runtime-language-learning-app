import {
  useEffect,
  useRef,
  useCallback,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { useApp } from '../context/AppContext';
import { Message } from './Message';
import { StreamingMessage } from './StreamingMessage';

export function ChatSection() {
  const { state, toggleRecording, restartConversation, sendTextMessage } =
    useApp();
  const [textInput, setTextInput] = useState('');
  const {
    chatHistory,
    currentTranscript,
    pendingTranscription,
    streamingLLMResponse,
    isRecording,
    speechDetected,
    connectionStatus,
    currentResponseId,
  } = state;

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const responseIdRef = useRef<string | null>(null);

  useEffect(() => {
    responseIdRef.current = currentResponseId;
  }, [currentResponseId]);

  // Instant scroll to bottom - used during streaming/typing
  const scrollToBottomInstant = useCallback(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop =
        messagesContainerRef.current.scrollHeight;
    }
  }, []);

  // Smooth scroll to bottom - used for new messages
  const scrollToBottomSmooth = useCallback(() => {
    requestAnimationFrame(() => {
      if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTo({
          top: messagesContainerRef.current.scrollHeight,
          behavior: 'smooth',
        });
      }
    });
  }, []);

  // Scroll when chat history changes (new messages added)
  useEffect(() => {
    scrollToBottomSmooth();
  }, [chatHistory, scrollToBottomSmooth]);

  // Scroll when streaming source content updates
  useEffect(() => {
    scrollToBottomInstant();
  }, [
    currentTranscript,
    pendingTranscription,
    streamingLLMResponse,
    scrollToBottomInstant,
  ]);

  const handleTextSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (textInput.trim()) {
        sendTextMessage(textInput);
        setTextInput('');
      }
    },
    [textInput, sendTextMessage]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (textInput.trim()) {
          sendTextMessage(textInput);
          setTextInput('');
        }
      }
    },
    [textInput, sendTextMessage]
  );

  const isConnected = connectionStatus === 'connected';

  return (
    <section className="chat-section">
      <div className="section-header">
        <h2>Conversation</h2>
        <div className="button-group">
          <button
            className="restart-button"
            id="restartButton"
            onClick={restartConversation}
            disabled={!isConnected}
            title="Restart conversation"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21.5 2v6h-6M21.5 8A9.5 9.5 0 0 0 12 2.5 9.5 9.5 0 0 0 2.5 12 9.5 9.5 0 0 0 12 21.5 9.5 9.5 0 0 0 21.5 12" />
            </svg>
          </button>
          <button
            className={`mic-button ${isRecording ? 'recording' : ''}`}
            id="micButton"
            onClick={toggleRecording}
            disabled={!isConnected}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
            >
              <path d="M12 1a4 4 0 0 0-4 4v6a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z" />
              <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </button>
        </div>
      </div>
      <div className="chat-container">
        <div className="messages" id="messages" ref={messagesContainerRef}>
          {/* Render existing conversation history */}
          {chatHistory.map((message, index) => (
            <Message key={`msg-${index}`} message={message} />
          ))}

          {/* Real-time transcript (while speaking) */}
          {speechDetected && isRecording && !pendingTranscription && (
            <div
              className="message learner streaming realtime"
              id="realtime-transcript"
            >
              <span className="transcript-text">{currentTranscript}</span>
              {!currentTranscript && (
                <span className="loading-dots">
                  <span></span>
                  <span></span>
                  <span></span>
                </span>
              )}
            </div>
          )}

          {/* Pending user transcription (final) - no typewriter, shown immediately */}
          {pendingTranscription && (
            <PendingTranscription text={pendingTranscription} />
          )}

          {/* Streaming LLM response */}
          {streamingLLMResponse && (
            <StreamingMessage text={streamingLLMResponse} />
          )}
        </div>
        <div className="current-transcript" id="currentTranscript">
          {currentTranscript}
        </div>
        <form className="text-input-form" onSubmit={handleTextSubmit}>
          <input
            type="text"
            className="text-input"
            placeholder="Type a message..."
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!isConnected}
          />
          <button
            type="submit"
            className="send-button"
            disabled={!isConnected || !textInput.trim()}
            title="Send message"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </form>
      </div>
    </section>
  );
}

// Simple component to show finalized user transcription (no typewriter effect)
function PendingTranscription({ text }: { text: string }) {
  return (
    <div className="message learner" id="pending-transcription">
      {text}
    </div>
  );
}
