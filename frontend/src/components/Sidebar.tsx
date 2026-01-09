import { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';

export function Sidebar() {
  const {
    state,
    selectConversation,
    createNewConversation,
    deleteConversation,
    renameConversation,
    toggleSidebar,
    changeLanguage,
  } = useApp();
  const {
    conversations,
    currentConversationId,
    sidebarOpen,
    availableLanguages,
    currentLanguage,
  } = state;

  // Helper to get flag for a language code
  const getFlag = (languageCode: string): string => {
    const lang = availableLanguages.find((l) => l.code === languageCode);
    return lang?.flag || '';
  };

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showLangMenu, setShowLangMenu] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const langMenuRef = useRef<HTMLDivElement>(null);

  const currentLang = availableLanguages.find(
    (l) => l.code === currentLanguage
  );

  // Focus input when editing starts
  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  // Close language menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        langMenuRef.current &&
        !langMenuRef.current.contains(event.target as Node)
      ) {
        setShowLangMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLanguageSelect = (langCode: string) => {
    if (langCode !== currentLanguage) {
      changeLanguage(langCode);
    }
    setShowLangMenu(false);
  };

  const startEditing = (conversationId: string, currentTitle: string) => {
    setEditingId(conversationId);
    setEditValue(currentTitle);
  };

  const saveEdit = () => {
    if (editingId && editValue.trim()) {
      renameConversation(editingId, editValue.trim());
    }
    setEditingId(null);
    setEditValue('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit();
    } else if (e.key === 'Escape') {
      cancelEdit();
    }
  };

  return (
    <>
      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={toggleSidebar} />
      )}

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="new-chat-wrapper" ref={langMenuRef}>
            <button
              className="new-chat-button"
              onClick={createNewConversation}
              title="Start a new conversation"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              New chat
            </button>
            <button
              className="new-chat-lang-button"
              onClick={() => setShowLangMenu(!showLangMenu)}
              title="Select language for new chat"
            >
              <span className="lang-flag">{currentLang?.flag || '🌐'}</span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {showLangMenu && (
              <div className="new-chat-lang-dropdown">
                {availableLanguages.map((lang) => (
                  <button
                    key={lang.code}
                    className={`lang-option ${lang.code === currentLanguage ? 'active' : ''}`}
                    onClick={() => handleLanguageSelect(lang.code)}
                  >
                    <span className="lang-flag">{lang.flag}</span>
                    <span className="lang-name">{lang.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className="sidebar-close-button"
            onClick={toggleSidebar}
            title="Close sidebar"
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
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="sidebar-conversations">
          {conversations.length === 0 ? (
            <div className="sidebar-empty">
              <p>No conversations yet</p>
              <p className="sidebar-empty-hint">
                Start a new chat to begin learning!
              </p>
            </div>
          ) : (
            <ul className="conversation-list">
              {conversations.map((conversation) => (
                <li
                  key={conversation.id}
                  className={`conversation-item ${
                    conversation.id === currentConversationId ? 'active' : ''
                  }`}
                >
                  {editingId === conversation.id ? (
                    <div className="conversation-edit">
                      <input
                        ref={inputRef}
                        type="text"
                        className="conversation-edit-input"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={saveEdit}
                        onKeyDown={handleKeyDown}
                      />
                    </div>
                  ) : (
                    <>
                      <button
                        className="conversation-button"
                        onClick={() => selectConversation(conversation.id)}
                      >
                        <span className="conversation-flag-left">
                          {getFlag(conversation.languageCode)}
                        </span>
                        <span className="conversation-title">
                          {conversation.title}
                        </span>
                      </button>
                      <div className="conversation-actions">
                        <button
                          className="conversation-action-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            startEditing(conversation.id, conversation.title);
                          }}
                          title="Rename conversation"
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        <button
                          className="conversation-action-btn conversation-delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteConversation(conversation.id);
                          }}
                          title="Delete conversation"
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}
