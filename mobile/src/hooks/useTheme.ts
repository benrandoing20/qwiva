// Theme tokens that flip with the system color scheme. Mirrors the web app's
// --brand-*-rgb tokens in frontend/app/globals.css. Brand identity colours
// (navy / accent / pink) stay in src/constants/colors.ts because they don't
// change between modes — only the surface, text, and border tokens do.
//
// Usage in a component:
//   const theme = useTheme();
//   <View style={{ backgroundColor: theme.bg }}>
//
// For static StyleSheets that need theme-driven colours, apply the dynamic
// tokens via inline style overrides:
//   <View style={[styles.card, { backgroundColor: theme.surface }]}>
import { useColorScheme } from 'react-native';
import { useThemeMode } from '@/contexts/ThemeContext';

export interface Theme {
  scheme: 'light' | 'dark';

  // Surfaces
  bg: string;
  surface: string;
  elevated: string;
  navyWash: string;       // subtle background tint for user bubbles, info cards

  // Borders
  border: string;
  borderFocus: string;

  // Text
  text: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;

  // Brand-aware accents (same in both modes — surfaced here for ergonomics)
  accent: string;
  accentSoft: string;     // 10% accent for backgrounds (citation pills, hovers)
  navy: string;
  pink: string;

  // Semantic
  danger: string;
  dangerWash: string;
  success: string;
  successWash: string;
  warning: string;
  warningWash: string;
  info: string;
  infoWash: string;

  // Component-specific helpers
  userBubble: string;
  pillBg: string;
}

const lightTheme: Theme = {
  scheme: 'light',

  bg: '#F6F8FC',          // web --brand-bg light: 246 248 252
  surface: '#FFFFFF',     // web --brand-surface light: 255 255 255
  elevated: '#E8EBF5',    // web --brand-raised light: 232 235 245
  navyWash: '#EEF3F9',

  border: '#C8CEE2',      // web --brand-border light: 200 206 226
  borderFocus: '#A855F7',

  text: '#1A234E',        // web --brand-text light: 26 35 78
  textSecondary: '#5C6488',
  textMuted: '#8B92B0',
  textInverse: '#FFFFFF',

  accent: '#A855F7',
  accentSoft: 'rgba(168,85,247,0.10)',
  navy: '#1A234E',
  pink: '#F472B6',

  danger: '#C0405A',
  dangerWash: '#FDEEF1',
  success: '#2D9E6B',
  successWash: '#E8F7F1',
  warning: '#D97706',
  warningWash: '#FEF3C7',
  info: '#4764AF',
  infoWash: '#EEF2FA',

  userBubble: '#E8EBF5',
  pillBg: 'rgba(168,85,247,0.10)',
};

const darkTheme: Theme = {
  scheme: 'dark',

  bg: '#050510',          // web --brand-bg dark: 5 5 16
  surface: '#131A35',     // web --brand-surface dark: 19 26 53
  elevated: '#161D3D',    // web --brand-raised dark: 22 29 61
  navyWash: '#1A234E',

  border: '#2A3558',      // web --brand-border dark: 42 53 88
  borderFocus: '#C084FC',

  text: '#EEF0F7',        // web --brand-text dark: 238 240 247
  textSecondary: '#8B92B0',
  textMuted: '#5C6488',
  textInverse: '#1A234E',

  accent: '#A855F7',
  accentSoft: 'rgba(168,85,247,0.18)',
  navy: '#1A234E',
  pink: '#F472B6',

  danger: '#E55A75',
  dangerWash: 'rgba(192,64,90,0.15)',
  success: '#5DBE92',
  successWash: 'rgba(45,158,107,0.15)',
  warning: '#F4A82E',
  warningWash: 'rgba(217,119,6,0.15)',
  info: '#7E97D6',
  infoWash: 'rgba(71,100,175,0.15)',

  userBubble: '#161D3D',
  pillBg: 'rgba(168,85,247,0.18)',
};

export function useTheme(): Theme {
  const systemScheme = useColorScheme();
  // Optionally read the user override from ThemeContext. We do it via try/catch
  // so any component still mounted outside the provider (e.g. transient
  // splash) falls back to the system scheme rather than crashing.
  let resolved: 'light' | 'dark';
  try {
    resolved = useThemeMode().scheme;
  } catch {
    resolved = systemScheme === 'light' ? 'light' : 'dark';
  }
  return resolved === 'dark' ? darkTheme : lightTheme;
}

// Direct exports for places that can't call hooks (e.g. const-evaluated
// stylesheets, or one-off render utilities). Prefer useTheme() in components.
export { lightTheme, darkTheme };
