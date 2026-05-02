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
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [resendStatus, setResendStatus] = useState<string | null>(null)

  useEffect(() => {
    if (searchParams.get('error') === 'confirmation_failed') {
      setError('Email confirmation failed. Please try signing up again or contact support.')
    }
  }, [searchParams])

  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [resendCooldown])

  async function handleResend() {
    if (!pendingEmail || resendCooldown > 0) return
    setResendStatus(null)
    const redirectTo = `${window.location.origin}/auth/callback?next=/onboarding`
    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email: pendingEmail,
      options: { emailRedirectTo: redirectTo },
    })
    if (resendError) {
      setResendStatus(resendError.message)
    } else {
      setResendStatus(`Confirmation email re-sent to ${pendingEmail}.`)
      setResendCooldown(30)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setLoading(true)

    if (mode === 'login') {
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password })
      setLoading(false)
      if (authError) {
        const code = (authError as { code?: string }).code
        if (code === 'email_not_confirmed' || /not confirmed/i.test(authError.message)) {
          setPendingEmail(email)
        }
        setError(authError.message)
        return
      }
      // Check if onboarding is complete — redirect new users to onboarding
      if (data.session) {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('onboarding_complete')
          .eq('user_id', data.session.user.id)
          .maybeSingle()
        if (!profile?.onboarding_complete) {
          router.push('/onboarding')
          return
        }
      }
      router.push('/')
    } else {
      // Pass ?next=/onboarding so the email confirmation callback lands on onboarding
      const redirectTo = `${window.location.origin}/auth/callback?next=/onboarding`
      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectTo,
          data: { first_name: firstName.trim(), last_name: lastName.trim() },
        },
      })
      setLoading(false)
      if (authError) { setError(authError.message); return }
      // If email confirmation is disabled, signUp returns a session immediately
      if (data.session) {
        const fn = firstName.trim()
        const ln = lastName.trim()
        if (fn || ln) {
          await supabase.from('user_profiles').upsert({
            user_id: data.session.user.id,
            first_name: fn || null,
            last_name: ln || null,
            display_name: [fn, ln].filter(Boolean).join(' ') || null,
          }, { onConflict: 'user_id' })
        }
        router.push('/onboarding')
        return
      }
      setSuccess('Check your email to confirm your account — you\'ll be taken straight to profile setup.')
      setPendingEmail(email)
      setResendCooldown(30)
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
              onClick={() => { setMode(m); setError(null); setSuccess(null); setFirstName(''); setLastName('') }}
              className={`flex-1 py-2 text-sm font-medium rounded-lg border transition-colors ${
                mode === m
                  ? 'bg-brand-raised text-brand-text border-brand-border/50'
                  : 'bg-transparent text-brand-muted hover:text-brand-text/90 border-transparent'
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
          {mode === 'signup' && (
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-brand-muted mb-1.5 uppercase tracking-wide">
                  First name
                </label>
                <input
                  type="text"
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First"
                  className="w-full px-3 py-2.5 bg-brand-bg border border-brand-border rounded-lg text-sm text-brand-text placeholder-brand-subtle outline-none focus:border-brand-accent/45 focus:ring-1 focus:ring-brand-accent/15 transition-all"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-brand-muted mb-1.5 uppercase tracking-wide">
                  Last name
                </label>
                <input
                  type="text"
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last"
                  className="w-full px-3 py-2.5 bg-brand-bg border border-brand-border rounded-lg text-sm text-brand-text placeholder-brand-subtle outline-none focus:border-brand-accent/45 focus:ring-1 focus:ring-brand-accent/15 transition-all"
                />
              </div>
            </div>
          )}
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

        {pendingEmail && (
          <div className="mt-4 bg-brand-surface border border-brand-border rounded-2xl px-6 py-5 space-y-2 text-center">
            <p className="text-xs text-brand-muted">
              Didn&apos;t get the email for <span className="text-brand-text">{pendingEmail}</span>?
            </p>
            <button
              type="button"
              onClick={handleResend}
              disabled={resendCooldown > 0}
              className="w-full py-2 text-sm font-medium text-brand-text bg-brand-raised hover:bg-brand-raised/80 disabled:opacity-40 disabled:cursor-not-allowed border border-brand-border/50 rounded-lg transition-colors"
            >
              {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend confirmation email'}
            </button>
            {resendStatus && (
              <p className="text-xs text-brand-muted pt-1">{resendStatus}</p>
            )}
          </div>
        )}
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
