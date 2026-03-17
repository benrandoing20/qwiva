import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: 'Qwiva — Clinical Search',
  description: 'Guideline-grounded clinical search for physicians in Kenya.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans bg-[#0f0f0f] text-[#e8e8e8] antialiased`}>
        {children}
      </body>
    </html>
  )
}
