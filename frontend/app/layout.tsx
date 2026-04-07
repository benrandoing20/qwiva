import type { Metadata } from 'next'
import { Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'
import PHProvider from '@/components/PHProvider'
import { ThemeProvider } from '@/components/ThemeProvider'

const brandSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-brand',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Qwiva — Clinical Search',
  description: 'Guideline-grounded clinical search for physicians in Kenya.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${brandSans.variable} font-sans bg-brand-bg text-brand-text antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          storageKey="qwiva-theme"
        >
          <PHProvider>{children}</PHProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
