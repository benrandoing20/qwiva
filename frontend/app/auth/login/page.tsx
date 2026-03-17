'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Mode = 'login' | 'signup'

export default function AuthPage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setLoading(true)

    if (mode === 'login') {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
      setLoading(false)
      if (authError) { setError(authError.message); return }
      router.push('/')
    } else {
      const { error: authError } = await supabase.auth.signUp({ email, password })
      setLoading(false)
      if (authError) { setError(authError.message); return }
      setSuccess('Check your email to confirm your account, then sign in.')
    }
  }

  return (
    <main className="min-h-screen bg-[#0f0f0f] flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-white tracking-tight">Qwiva</h1>
          <p className="text-sm text-[#6b6b6b] mt-2">Kenya's clinical knowledge platform</p>
        </div>

        {/* Mode toggle */}
        <div className="flex mb-6 bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-1">
          {(['login', 'signup'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setError(null); setSuccess(null) }}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
                mode === m
                  ? 'bg-[#2a2a2a] text-white'
                  : 'text-[#6b6b6b] hover:text-[#9a9a9a]'
              }`}
            >
              {m === 'login' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl px-6 py-7 space-y-4"
        >
          <div>
            <label className="block text-xs font-medium text-[#9a9a9a] mb-1.5 uppercase tracking-wide">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2.5 bg-[#0f0f0f] border border-[#2a2a2a] rounded-lg text-sm text-[#e8e8e8] placeholder-[#4a4a4a] outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20 transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#9a9a9a] mb-1.5 uppercase tracking-wide">
              Password
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 bg-[#0f0f0f] border border-[#2a2a2a] rounded-lg text-sm text-[#e8e8e8] placeholder-[#4a4a4a] outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20 transition-all"
            />
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}
          {success && (
            <p className="text-xs text-teal-400 bg-teal-500/10 border border-teal-500/20 px-3 py-2 rounded-lg">
              {success}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 text-sm font-semibold text-white bg-teal-500 hover:bg-teal-400 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors mt-2"
          >
            {loading
              ? (mode === 'login' ? 'Signing in…' : 'Creating account…')
              : (mode === 'login' ? 'Sign in' : 'Create account')}
          </button>
        </form>
      </div>
    </main>
  )
}
