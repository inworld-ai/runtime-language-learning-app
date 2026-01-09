import { AppProvider } from './context/AppContext';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { ChatSection } from './components/ChatSection';
import { FlashcardsSection } from './components/FlashcardsSection';
import './styles/main.css';

function AppContent() {
  return (
    <div className="app-wrapper">
      <Header />
      <div className="app-layout">
        <Sidebar />
        <div className="app-main">
          <main className="main">
            <div className="container">
              <div className="app-grid">
                <ChatSection />
                <FlashcardsSection />
              </div>
            </div>
          </main>
          {/* Hidden audio element for iOS compatibility */}
          <audio id="iosAudioElement" style={{ display: 'none' }} playsInline />
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}

export default App;
