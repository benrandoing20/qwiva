'use client'

import { FormEvent, useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import BrandLogo from '@/components/BrandLogo'
import ThemeToggle from '@/components/ThemeToggle'

type Mode = 'login' | 'signup'

// Isolated because useSearchParams() requires a Suspense boundary in Next.js 14
function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (searchParams.get('error') === 'confirmation_failed') {
      setError('Email confirmation failed. Please try signing up again or contact support.')
    }
  }, [searchParams])

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
      const redirectTo = `${window.location.origin}/auth/callback`
      const { error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectTo },
      })
      setLoading(false)
      if (authError) { setError(authError.message); return }
      setSuccess('Check your email to confirm your account, then sign in.')
    }
  }

  return (
    <main className="relative min-h-screen bg-brand-bg flex flex-col items-center justify-center px-4">
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="text-center mb-10">
          <div className="flex justify-center mb-4">
            <BrandLogo width={180} height={64} className="h-14 w-auto" priority />
          </div>
          <p className="text-sm text-brand-muted">Kenya&apos;s clinical knowledge platform</p>
        </div>

        {/* Mode toggle */}
        <div className="flex mb-6 bg-brand-surface border border-brand-border rounded-xl p-1">
          {(['login', 'signup'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setError(null); setSuccess(null) }}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
                mode === m
                  ? 'bg-brand-raised text-brand-text border border-brand-border/50'
                  : 'text-brand-muted hover:text-brand-text/90'
              }`}
            >
              {m === 'login' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-brand-surface border border-brand-border rounded-2xl px-6 py-7 space-y-4"
        >
          <div>
            <label className="block text-xs font-medium text-brand-muted mb-1.5 uppercase tracking-wide">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2.5 bg-brand-bg border border-brand-border rounded-lg text-sm text-brand-text placeholder-brand-subtle outline-none focus:border-brand-accent/45 focus:ring-1 focus:ring-brand-accent/15 transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-brand-muted mb-1.5 uppercase tracking-wide">
              Password
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 bg-brand-bg border border-brand-border rounded-lg text-sm text-brand-text placeholder-brand-subtle outline-none focus:border-brand-accent/45 focus:ring-1 focus:ring-brand-accent/15 transition-all"
            />
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}
          {success && (
            <p className="text-xs text-brand-accent-hover bg-brand-accent/12 border border-brand-accent/25 px-3 py-2 rounded-lg">
              {success}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 text-sm font-semibold text-white bg-brand-accent hover:bg-brand-accent-hover disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors mt-2 shadow-[0_0_28px_-6px_rgba(168,85,247,0.55)]"
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

export default function AuthPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
