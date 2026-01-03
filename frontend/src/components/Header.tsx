import { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';

export function Header() {
  const { state, toggleSidebar } = useApp();
  const { connectionStatus } = state;
  const { user, isLoading, isConfigured, signUp, signIn, signOut } = useAuth();

  const [showMenu, setShowMenu] = useState(false);
  const [showAuthForm, setShowAuthForm] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const statusMessages: Record<string, string> = {
    connecting: 'Connecting...',
    connected: 'Connected',
    disconnected: 'Disconnected',
  };

  // Close menus when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
        setShowAuthForm(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const result = isSignUp
      ? await signUp(email, password)
      : await signIn(email, password);

    setSubmitting(false);

    if (result.error) {
      setError(result.error);
    } else {
      setShowAuthForm(false);
      setEmail('');
      setPassword('');
    }
  };

  const toggleAuthMode = () => {
    setIsSignUp(!isSignUp);
    setError(null);
  };

  const handleSignOut = async () => {
    await signOut();
    setShowMenu(false);
  };

  return (
    <header className="header">
      <div className="header-content">
        <div className="header-left">
          <button
            className="menu-toggle"
            onClick={toggleSidebar}
            aria-label="Toggle sidebar"
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <h1 className="header-logo">Inworld Language Tutor</h1>
        </div>

        <div className="header-right">
          {/* Settings Menu */}
          <div ref={menuRef} style={{ position: 'relative' }}>
            <button
              className="logo-menu-button"
              onClick={() => setShowMenu(!showMenu)}
              aria-label="Open menu"
            >
              <img src="/favicon.svg" alt="Menu" className="logo-icon" />
            </button>

            {showMenu && (
              <div className="header-dropdown">
                {/* Connection Status */}
                <div className="dropdown-item dropdown-status">
                  <span className={`status-dot ${connectionStatus}`} />
                  <span>{statusMessages[connectionStatus] || 'Unknown'}</span>
                </div>

                {/* Auth Section */}
                {isConfigured && (
                  <>
                    <div className="dropdown-divider" />
                    {isLoading ? (
                      <div className="dropdown-item dropdown-loading">
                        Loading...
                      </div>
                    ) : user ? (
                      <>
                        <div className="dropdown-item dropdown-user">
                          <span className="dropdown-label">Signed in as</span>
                          <span className="dropdown-email">{user.email}</span>
                        </div>
                        <button
                          className="dropdown-item dropdown-button"
                          onClick={handleSignOut}
                        >
                          Sign Out
                        </button>
                      </>
                    ) : !showAuthForm ? (
                      <button
                        className="dropdown-item dropdown-button"
                        onClick={() => setShowAuthForm(true)}
                      >
                        Sign In
                      </button>
                    ) : (
                      <form
                        onSubmit={handleSubmit}
                        className="dropdown-auth-form"
                      >
                        <div className="dropdown-auth-header">
                          {isSignUp ? 'Create Account' : 'Sign In'}
                        </div>
                        {error && (
                          <div className="dropdown-auth-error">{error}</div>
                        )}
                        <input
                          type="email"
                          placeholder="Email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          required
                          autoComplete="email"
                          className="dropdown-input"
                        />
                        <input
                          type="password"
                          placeholder="Password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          minLength={6}
                          autoComplete={
                            isSignUp ? 'new-password' : 'current-password'
                          }
                          className="dropdown-input"
                        />
                        <button
                          type="submit"
                          className="dropdown-submit"
                          disabled={submitting}
                        >
                          {submitting
                            ? '...'
                            : isSignUp
                              ? 'Create Account'
                              : 'Sign In'}
                        </button>
                        <button
                          type="button"
                          className="dropdown-toggle-auth"
                          onClick={toggleAuthMode}
                        >
                          {isSignUp
                            ? 'Have an account? Sign In'
                            : 'Need an account? Sign Up'}
                        </button>
                      </form>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
