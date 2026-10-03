import { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { ReleaseNotesDialog } from './components/ReleaseNotesDialog';
import { UiStylePicker } from './components/UiStylePicker';
import { UpdateToast } from './components/UpdateToast';
import { LoginGate } from './components/LoginGate';
import { useAuth } from './hooks/useAuth';
import { applyUiStyle } from './hooks/useUiStyle';
import { useSettings } from './hooks/useSettings';
import { JobsProvider } from './hooks/useJobs';
import { DownloaderProvider } from './hooks/useDownloader';
import { Dashboard } from './routes/Dashboard';
import { Explore } from './routes/Explore';
import { Discover } from './routes/Discover';
import { LibraryView } from './routes/LibraryView';
import { Boards, BoardView } from './routes/Boards';
import { Settings } from './routes/settings';
import { DownloaderPage } from './routes/downloader/DownloaderPage';

export function App() {
  const { loading, enabled, unlocked } = useAuth();
  const settings = useSettings(unlocked);

  useEffect(() => {
    if (settings?.accent_color) {
      document.documentElement.style.setProperty('--accent', settings.accent_color);
    }
  }, [settings?.accent_color]);

  useEffect(() => {
    if (settings?.ui_style) applyUiStyle(settings.ui_style);
  }, [settings?.ui_style]);

  if (loading) return null;
  // Only gate when the server says login is on. An unreachable server has no auth status at all,
  // and showing a password prompt for it sends people hunting for a password that doesn't exist.
  if (enabled && !unlocked) return <LoginGate />;

  return (
    <JobsProvider>
      <DownloaderProvider>
        {/* The bottom padding keeps the last row clear of the phone dock. It lives here rather than
            on <body> so the login screen, which has no dock, doesn't get it, and min-h-dvh counts it
            so a page that fits the screen doesn't scroll by the dock's height. */}
        <div className="relative min-h-dvh pb-(--dock-h) text-zinc-100">
          {/* The style question comes first and only once per install. "What's new" waits until it's
              answered, so a first visit never opens two dialogs on top of each other. */}
          {settings &&
            (settings.ui_style_chosen !== '1' ? <UiStylePicker current={settings.ui_style} /> : <ReleaseNotesDialog />)}
          <UpdateToast />
          <Navbar />
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/explore" element={<Explore />} />
            <Route path="/discover" element={<Discover />} />
            <Route path="/boards" element={<Boards />} />
            <Route path="/boards/:id" element={<BoardView />} />
            <Route path="/library/:id" element={<LibraryView />} />
            <Route path="/downloader" element={<DownloaderPage />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </div>
      </DownloaderProvider>
    </JobsProvider>
  );
}
