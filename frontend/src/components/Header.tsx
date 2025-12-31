import { useApp } from '../context/AppContext';

export function Header() {
  const { state, changeLanguage } = useApp();
  const { connectionStatus, currentLanguage, availableLanguages } = state;

  const statusMessages: Record<string, string> = {
    connecting: 'Connecting...',
    connected: 'Connected',
    disconnected: 'Disconnected',
  };

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLanguage = e.target.value;
    if (newLanguage !== currentLanguage) {
      changeLanguage(newLanguage);
    }
  };

  return (
    <header className="header">
      <div className="container">
        <h1 className="logo">Inworld Language Tutor</h1>
        <div className="header-controls">
          <div className="language-selector">
            <select
              id="languageSelect"
              className="language-dropdown"
              value={currentLanguage}
              onChange={handleLanguageChange}
              disabled={connectionStatus !== 'connected'}
            >
              {availableLanguages.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.flag} {lang.name}
                </option>
              ))}
            </select>
          </div>
          <div className="status-indicator">
            <span className={`status-dot ${connectionStatus}`} id="statusDot" />
            <span className="status-text" id="statusText">
              {statusMessages[connectionStatus] || 'Unknown'}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
