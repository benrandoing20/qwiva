import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          bg: 'rgb(var(--brand-bg-rgb) / <alpha-value>)',
          surface: 'rgb(var(--brand-surface-rgb) / <alpha-value>)',
          raised: 'rgb(var(--brand-raised-rgb) / <alpha-value>)',
          border: 'rgb(var(--brand-border-rgb) / <alpha-value>)',
          navy: 'rgb(var(--brand-navy-rgb) / <alpha-value>)',
          text: 'rgb(var(--brand-text-rgb) / <alpha-value>)',
          muted: 'rgb(var(--brand-muted-rgb) / <alpha-value>)',
          subtle: 'rgb(var(--brand-subtle-rgb) / <alpha-value>)',
          accent: 'rgb(var(--brand-accent-rgb) / <alpha-value>)',
          'accent-hover': 'rgb(var(--brand-accent-hover-rgb) / <alpha-value>)',
          pink: 'rgb(var(--brand-pink-rgb) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['var(--font-brand)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}

export default config
