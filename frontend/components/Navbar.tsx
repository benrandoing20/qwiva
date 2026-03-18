'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function Navbar() {
  const router = useRouter()
  const pathname = usePathname()

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  return (
    <header className="fixed top-0 inset-x-0 z-50 flex items-center justify-between px-6 h-14 border-b border-white/5 bg-[#0f0f0f]/80 backdrop-blur-sm">
      <div className="flex items-center gap-6">
        <span className="text-white font-semibold tracking-tight text-base">Qwiva</span>
        <nav className="flex items-center gap-1">
          <Link
            href="/"
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              pathname === '/'
                ? 'text-white bg-white/5'
                : 'text-[#6b6b6b] hover:text-white'
            }`}
          >
            Search
          </Link>
          <Link
            href="/learn"
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              pathname === '/learn'
                ? 'text-white bg-white/5'
                : 'text-[#6b6b6b] hover:text-white'
            }`}
          >
            Learn
          </Link>
        </nav>
      </div>
      <button
        onClick={signOut}
        className="text-sm text-[#6b6b6b] hover:text-white transition-colors"
      >
        Sign out
      </button>
    </header>
  )
}
