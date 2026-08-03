import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { AppSettings, HistoryItem, Lang } from './types';
import { translate } from './i18n';

const STORAGE_KEY = 'qr_studio_state_v1';

interface AppState {
  settings: AppSettings;
  history: HistoryItem[];
  setSettings: (partial: Partial<AppSettings>) => void;
  addHistory: (item: Omit<HistoryItem, 'id' | 'createdAt' | 'isFavorite'>) => HistoryItem;
  toggleFavorite: (id: string) => void;
  deleteHistory: (id: string) => void;
  clearHistory: () => void;
  importHistory: (items: HistoryItem[]) => void;
  t: (key: string) => string;
  dir: 'rtl' | 'ltr';
}

const defaultSettings: AppSettings = {
  lang: 'en',
  theme: 'light',
  autoOpenLinks: false,
  sound: true,
  vibration: true,
  defaultCamera: 'environment',
};

const AppContext = createContext<AppState | null>(null);

interface StoredState {
  settings: AppSettings;
  history: HistoryItem[];
}

function loadState(): StoredState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredState;
      return {
        settings: { ...defaultSettings, ...parsed.settings },
        history: parsed.history ?? [],
      };
    }
  } catch {
    // ignore
  }
  return { settings: defaultSettings, history: [] };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const initial = loadState();
  const [settings, setSettingsState] = useState<AppSettings>(initial.settings);
  const [history, setHistory] = useState<HistoryItem[]>(initial.history);

  useEffect(() => {
    const state: StoredState = { settings, history };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [settings, history]);

  useEffect(() => {
    document.documentElement.lang = settings.lang;
    document.documentElement.dir = settings.lang === 'ar' ? 'rtl' : 'ltr';
  }, [settings.lang]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.theme === 'dark');
  }, [settings.theme]);

  const setSettings = useCallback((partial: Partial<AppSettings>) => {
    setSettingsState((prev) => ({ ...prev, ...partial }));
  }, []);

  const addHistory = useCallback(
    (item: Omit<HistoryItem, 'id' | 'createdAt' | 'isFavorite'>): HistoryItem => {
      const full: HistoryItem = {
        ...item,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: Date.now(),
        isFavorite: false,
      };
      setHistory((prev) => [full, ...prev].slice(0, 500));
      return full;
    },
    [],
  );

  const toggleFavorite = useCallback((id: string) => {
    setHistory((prev) => prev.map((h) => (h.id === id ? { ...h, isFavorite: !h.isFavorite } : h)));
  }, []);

  const deleteHistory = useCallback((id: string) => {
    setHistory((prev) => prev.filter((h) => h.id !== id));
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  const importHistory = useCallback((items: HistoryItem[]) => {
    setHistory((prev) => {
      const ids = new Set(prev.map((h) => h.id));
      const newItems = items.filter((i) => !ids.has(i.id));
      return [...newItems, ...prev].slice(0, 500);
    });
  }, []);

  const t = useCallback((key: string) => translate(settings.lang, key), [settings.lang]);

  const value: AppState = {
    settings,
    history,
    setSettings,
    addHistory,
    toggleFavorite,
    deleteHistory,
    clearHistory,
    importHistory,
    t,
    dir: settings.lang === 'ar' ? 'rtl' : 'ltr',
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

export function useLang(): Lang {
  const { settings } = useApp();
  return settings.lang;
}
