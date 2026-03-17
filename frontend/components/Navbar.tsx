'use client'

import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function Navbar() {
  const router = useRouter()

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  return (
    <header className="fixed top-0 inset-x-0 z-50 flex items-center justify-between px-6 h-14 border-b border-white/5 bg-[#0f0f0f]/80 backdrop-blur-sm">
      <span className="text-white font-semibold tracking-tight text-base">Qwiva</span>
      <button
        onClick={signOut}
        className="text-sm text-[#6b6b6b] hover:text-white transition-colors"
      >
        Sign out
      </button>
    </header>
  )
}
