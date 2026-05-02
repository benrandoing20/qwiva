// Theme override layer. The app palette in src/hooks/useTheme.ts is keyed off
// `'light' | 'dark'`; this context decides which one is active by combining the
// system color scheme with a user override stored in AsyncStorage.
//
// Usage:
//   const { mode, scheme, setMode, toggle } = useThemeMode();
//
// `mode` is the user preference (`'system' | 'light' | 'dark'`).
// `scheme` is the resolved scheme used to look up the palette.
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ThemeScheme = 'light' | 'dark';

interface ThemeModeContextValue {
  mode: ThemeMode;
  scheme: ThemeScheme;
  setMode: (next: ThemeMode) => void;
  toggle: () => void;
}

const STORAGE_KEY = 'qwiva.themeMode';

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('dark');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!alive) return;
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setModeState(stored);
        }
      })
      .finally(() => {
        if (alive) setHydrated(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const scheme: ThemeScheme = useMemo(() => {
    if (mode === 'system') return systemScheme === 'light' ? 'light' : 'dark';
    return mode;
  }, [mode, systemScheme]);

  const toggle = useCallback(() => {
    // Cycle dark → light → dark. We collapse 'system' into the resolved scheme
    // before flipping so the toggle feels predictable.
    const current: ThemeScheme = mode === 'system' ? scheme : mode;
    setMode(current === 'dark' ? 'light' : 'dark');
  }, [mode, scheme, setMode]);

  const value: ThemeModeContextValue = { mode, scheme, setMode, toggle };

  if (!hydrated) {
    // Avoid a flash of the wrong theme on cold start by holding render until the
    // stored preference is loaded.
    return null;
  }

  return (
    <ThemeModeContext.Provider value={value}>{children}</ThemeModeContext.Provider>
  );
}

export function useThemeMode(): ThemeModeContextValue {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) throw new Error('useThemeMode must be used within ThemeProvider');
  return ctx;
}
