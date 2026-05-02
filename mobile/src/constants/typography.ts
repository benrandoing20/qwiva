// All Fonts.* tokens point at Plus Jakarta Sans weights to match the web app
// (frontend uses Plus_Jakarta_Sans via next/font/google). Token names are kept
// stable so existing components don't need to change — only the underlying
// font swaps. Italics fall back to the bold variant since Plus Jakarta does
// not ship a regular italic in the @expo-google-fonts package.
export const Fonts = {
  display: 'PlusJakartaSans_700Bold',
  displayMedium: 'PlusJakartaSans_600SemiBold',
  displayItalic: 'PlusJakartaSans_500Medium_Italic',
  sans: 'PlusJakartaSans_400Regular',
  sansMedium: 'PlusJakartaSans_500Medium',
  sansBold: 'PlusJakartaSans_700Bold',
  sansBlack: 'PlusJakartaSans_800ExtraBold',
  mono: 'PlusJakartaSans_400Regular',
  gilroyLight: 'PlusJakartaSans_300Light',
  gilroySemiBold: 'PlusJakartaSans_600SemiBold',
} as const;

export const FontSizes = {
  display: 34,
  h1: 28,
  h2: 22,
  h3: 18,
  body: 15,
  bodySm: 13,
  label: 12,
  eyebrow: 11,
  mono: 11,
} as const;

export const LineHeights = {
  tight: 1.15,
  snug: 1.3,
  normal: 1.5,
  loose: 1.65,
} as const;
