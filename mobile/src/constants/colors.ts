// Static palette — kept aligned with the web app's LIGHT theme. The runtime
// app surfaces (Ask, Sidebar, Me) use useTheme() instead of these constants
// so they switch with the system color scheme. Onboarding screens still read
// Colors.* directly and therefore render in light mode regardless of system
// preference; that's intentional for v1.
export const Colors = {
  // Core Brand — synced with web's --brand-navy / --brand-accent / --brand-pink
  navy: '#1A234E',
  purple: '#A855F7',
  lilac: '#C084FC',
  pink: '#F472B6',

  // Surfaces — match web's light theme tokens
  bgBase: '#F6F8FC',       // web --brand-bg light
  bgSurface: '#E8EBF5',    // web --brand-raised light
  bgElevated: '#FFFFFF',   // web --brand-surface light
  bgNavyWash: '#EEF3F9',
  bgSidebar: '#E8EBF5',

  // Text — match web's light theme
  textPrimary: '#1A234E',
  textSecondary: '#5C6488',
  textMuted: '#8B92B0',
  textInverse: '#FFFFFF',

  // Semantic
  success: '#2D9E6B',
  successWash: '#E8F7F1',
  warning: '#D97706',
  warningWash: '#FEF3C7',
  danger: '#C0405A',
  dangerWash: '#FDEEF1',
  info: '#4764AF',
  infoWash: '#EEF2FA',

  // Interactive States — synced with web hover/disabled tones
  purpleHover: '#9333EA',
  purpleDisabled: '#D6BCFA',
  navyPressed: '#0F1638',
  borderDefault: '#C8CEE2',
  borderFocus: '#A855F7',

  // Gamification
  xpGold: '#F5A623',
  streakFire: '#FF6B35',
  heartRed: '#E84545',
  tierOracle: '#6F5091',
  tierClinician: '#4764AF',
  tierHealer: '#2D9E6B',

  // Dark mode
  darkBg: '#0E1420',
  darkSurface: '#1A2235',
  darkElevated: '#243044',
  darkBorder: 'rgba(255,255,255,0.10)',
  darkText: '#F0F0F8',
  darkMuted: 'rgba(240,240,248,0.55)',
} as const;
