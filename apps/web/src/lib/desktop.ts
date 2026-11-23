import { useEffect, useState } from 'react';

/** Mirrors the state desktop/updates.js keeps; the desktop app sends it whenever it changes. */
export interface DesktopUpdateState {
  status: 'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'error';
  currentVersion: string;
  /** The version being downloaded or ready to install. */
  version: string | null;
  percent: number;
  error: string | null;
  checkedAt: number | null;
  /** Set on the first start after an update installed, until dismissed. */
  justUpdated: string | null;
  autoUpdate: boolean;
}

/** What desktop/preload.cjs exposes. Absent in a browser, including one opened from the desktop app. */
export interface DesktopBridge {
  updates: {
    getState(): Promise<DesktopUpdateState | null>;
    onState(callback: (state: DesktopUpdateState) => void): () => void;
    check(): Promise<void>;
    install(): Promise<void>;
    setAutoUpdate(on: boolean): Promise<void>;
    dismissUpdated(): Promise<void>;
  };
}

declare global {
  interface Window {
    sakuyaDesktop?: DesktopBridge;
  }
}

export const desktopBridge = (): DesktopBridge | undefined =>
  typeof window === 'undefined' ? undefined : window.sakuyaDesktop;

/** The desktop app's update state, or null outside it (or while its updater is off, as in a dev run). */
export function useDesktopUpdates(): DesktopUpdateState | null {
  const [state, setState] = useState<DesktopUpdateState | null>(null);
  useEffect(() => {
    const updates = desktopBridge()?.updates;
    if (!updates) return;
    let live = true;
    const off = updates.onState((next) => live && setState(next));
    updates.getState().then((initial) => live && initial && setState((current) => current ?? initial));
    return () => {
      live = false;
      off();
    };
  }, []);
  return state;
}
