import { AppProvider } from './context/AppContext';
import { Header } from './components/Header';
import { ChatSection } from './components/ChatSection';
import { FlashcardsSection } from './components/FlashcardsSection';
import './styles/main.css';

function AppContent() {
  return (
    <>
      <Header />
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
    </>
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
