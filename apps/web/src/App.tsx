import { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from './lib/api';
import { Navbar } from './components/Navbar';
import { ReleaseNotesDialog } from './components/ReleaseNotesDialog';
import { JobsProvider } from './hooks/useJobs';
import { DownloaderProvider } from './hooks/useDownloader';
import { Dashboard } from './routes/Dashboard';
import { Board } from './routes/Board';
import { LibraryView } from './routes/LibraryView';
import { Settings } from './routes/settings';
import { DownloaderPage } from './routes/downloader/DownloaderPage';

export function App() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings, staleTime: 60_000 });

  useEffect(() => {
    if (settings?.accent_color) {
      document.documentElement.style.setProperty('--accent', settings.accent_color);
    }
  }, [settings?.accent_color]);

  return (
    <JobsProvider>
      <DownloaderProvider>
        <div className="relative min-h-screen bg-zinc-950 text-zinc-100">
          <ReleaseNotesDialog />
          <Navbar />
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/board" element={<Board />} />
            <Route path="/library/:id" element={<LibraryView />} />
            <Route path="/downloader" element={<DownloaderPage />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </div>
      </DownloaderProvider>
    </JobsProvider>
  );
}
