'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import BrandLogo from '@/components/BrandLogo'
import ThemeToggle from '@/components/ThemeToggle'

interface NavbarProps {
  onToggleSidebar?: () => void
  onNewChat?: () => void
}

export default function Navbar({ onToggleSidebar, onNewChat }: NavbarProps) {
  const router = useRouter()
  const pathname = usePathname()

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  return (
    <header className="fixed top-0 inset-x-0 z-50 flex items-center justify-between px-6 h-14 bg-brand-bg">
      <div className="flex items-center gap-6">
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className="md:hidden p-1.5 -ml-1 text-brand-muted hover:text-brand-text transition-colors"
            aria-label="Toggle sidebar"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        )}
        {/* <BrandLogo width={104} height={36} className="h-8 w-auto" priority /> */}
        <nav className="flex items-center gap-1">
          <Link
            href="/"
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              pathname === '/'
                ? 'text-brand-text bg-brand-raised'
                : 'text-brand-muted hover:text-brand-text'
            }`}
          >
            Search
          </Link>
          <Link
            href="/surveys"
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              pathname?.startsWith('/surveys')
                ? 'text-brand-text bg-brand-raised'
                : 'text-brand-muted hover:text-brand-text'
            }`}
          >
            Surveys
          </Link>
          <Link
            href="/discover"
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              pathname === '/discover'
                ? 'text-brand-text bg-brand-raised'
                : 'text-brand-muted hover:text-brand-text'
            }`}
          >
            Discover
          </Link>
          <Link
            href="/learn"
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              pathname === '/learn'
                ? 'text-brand-text bg-brand-raised'
                : 'text-brand-muted hover:text-brand-text'
            }`}
          >
            Learn
          </Link>
        </nav>
      </div>
      <div className="flex items-center gap-1">
        {onNewChat && (
          <button
            onClick={onNewChat}
            className="p-1.5 text-brand-muted hover:text-brand-text transition-colors"
            aria-label="New chat"
            title="New chat"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
          </button>
        )}
        <ThemeToggle />
        <Link
          href="/profile/me"
          className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
            pathname?.startsWith('/profile')
              ? 'text-brand-text bg-brand-raised'
              : 'text-brand-muted hover:text-brand-text'
          }`}
        >
          Profile
        </Link>
        <button
          onClick={signOut}
          className="text-sm text-brand-muted hover:text-brand-text transition-colors px-3 py-1.5"
        >
          Sign out
        </button>
      </div>
    </header>
  )
}
