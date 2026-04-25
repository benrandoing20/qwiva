'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, getAccessToken } from '@/lib/supabase'
import { completeOnboarding } from '@/lib/api'

const SPECIALTIES = [
  'General Medicine / Internal Medicine',
  'Family Medicine / General Practice',
  'Emergency Medicine',
  'Pediatrics / Child Health',
  'Obstetrics & Gynecology',
  'Surgery (General)',
  'Psychiatry / Mental Health',
  'Radiology / Imaging',
  'Anesthesiology',
  'Cardiology',
  'Neurology',
  'Oncology',
  'Orthopedics',
  'Ophthalmology',
  'ENT (Ear, Nose & Throat)',
  'Dermatology',
  'Infectious Disease',
  'Pulmonology / Respiratory Medicine',
  'Nephrology / Renal Medicine',
  'Gastroenterology',
  'Endocrinology / Diabetes',
  'Rheumatology',
  'Urology',
  'Hematology',
  'Pathology',
  'Public Health / Community Medicine',
  'Nursing',
  'Pharmacy',
  'Dentistry',
  'Clinical Nutrition / Dietetics',
  'Other',
]

const COUNTRIES = ['Kenya']

const INTERESTS = [
  'Malaria', 'HIV/AIDS', 'Tuberculosis', 'Maternal Health', 'Child Health',
  'Nutrition & SAM', 'Diabetes & Endocrinology', 'Hypertension & Cardiology',
  'Infectious Disease', 'Emergency Medicine', 'Surgery', 'Mental Health',
  'Cancer / Oncology', 'Kidney Disease', 'Respiratory Medicine',
  'Neurology', 'Dermatology', 'Ophthalmology', 'Palliative Care',
  'Public Health', 'Medical Education', 'Research & Evidence',
  'Healthcare Technology', 'Global Health',
]

const TOTAL_STEPS = 4

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Step 1: basics
  const [displayName, setDisplayName] = useState('')
  const [country, setCountry] = useState('Kenya')

  // Step 2: professional
  const [specialty, setSpecialty] = useState('')
  const [subspecialty, setSubspecialty] = useState('')
  const [institution, setInstitution] = useState('')
  const [yearsExp, setYearsExp] = useState('')
  const [medLicense, setMedLicense] = useState('')

  // Step 3: interests
  const [interests, setInterests] = useState<string[]>([])
  const [bio, setBio] = useState('')

  // Step 4: done
  const [done, setDone] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.push('/auth/login')
    })
  }, [router])

  function toggleInterest(interest: string) {
    setInterests((prev) =>
      prev.includes(interest) ? prev.filter((i) => i !== interest) : [...prev, interest]
    )
  }

  async function handleFinish() {
    setLoading(true)
    setError(null)
    try {
      const token = await getAccessToken()
      if (!token) { router.push('/auth/login'); return }
      await completeOnboarding({
        display_name: displayName.trim() || 'Physician',
        country,
        specialty: specialty || null,
        subspecialty: subspecialty.trim() || null,
        institution: institution.trim() || null,
        years_experience: yearsExp ? parseInt(yearsExp) : null,
        medical_license: medLicense.trim() || null,
        bio: bio.trim() || null,
        interests,
        languages: [],
      }, token)
      setDone(true)
      setTimeout(() => router.push('/community'), 1200)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  const canAdvance1 = displayName.trim().length >= 2

  if (done) {
    return (
      <main className="min-h-screen bg-brand-bg flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">🎉</div>
          <h1 className="text-xl font-bold text-brand-text">Welcome to Qwiva Community!</h1>
          <p className="text-brand-muted mt-2 text-sm">Taking you to the feed…</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-brand-bg flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        {/* Progress */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-brand-muted">Step {step} of {TOTAL_STEPS}</p>
            <p className="text-xs text-brand-muted">{Math.round((step / TOTAL_STEPS) * 100)}%</p>
          </div>
          <div className="h-1 bg-brand-border rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-accent rounded-full transition-all duration-500"
              style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
            />
          </div>
        </div>

        {/* Skip link */}
        <div className="flex justify-end mb-4">
          <button
            onClick={() => router.push('/')}
            className="text-xs text-brand-muted hover:text-brand-text transition-colors"
          >
            Skip for now →
          </button>
        </div>

        {/* Step 1: Welcome */}
        {step === 1 && (
          <div className="animate-fadeIn">
            <h1 className="text-2xl font-bold text-brand-text mb-2">Welcome to Qwiva Community</h1>
            <p className="text-brand-muted text-sm mb-8">
              Connect with physicians across Kenya. Let&apos;s set up your profile in a few quick steps.
            </p>
            <div className="space-y-4 bg-brand-surface border border-brand-border rounded-2xl p-6">
              <div>
                <label className="block text-xs font-medium text-brand-muted mb-1.5 uppercase tracking-wide">
                  Your name or preferred display name *
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Dr. Amina Wanjiku"
                  className="w-full px-3 py-2.5 bg-brand-bg border border-brand-border rounded-lg text-sm text-brand-text placeholder-brand-subtle outline-none focus:border-brand-accent/45 focus:ring-1 focus:ring-brand-accent/15 transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-brand-muted mb-1.5 uppercase tracking-wide">
                  Country *
                </label>
                <div className="w-full px-3 py-2.5 bg-brand-surface border border-brand-border rounded-lg text-sm text-brand-text flex items-center gap-2">
                  <span>🇰🇪</span>
                  <span>Kenya</span>
                </div>
              </div>
            </div>
            <button
              onClick={() => canAdvance1 && setStep(2)}
              disabled={!canAdvance1}
              className="w-full mt-6 py-3 text-sm font-semibold text-white bg-brand-accent hover:bg-brand-accent-hover disabled:opacity-40 disabled:cursor-not-allowed rounded-xl transition-colors"
            >
              Continue →
            </button>
          </div>
        )}

        {/* Step 2: Professional details */}
        {step === 2 && (
          <div className="animate-fadeIn">
            <h1 className="text-2xl font-bold text-brand-text mb-2">Your Practice</h1>
            <p className="text-brand-muted text-sm mb-8">
              Help peers find and connect with you by specialty and institution.
            </p>
            <div className="space-y-4 bg-brand-surface border border-brand-border rounded-2xl p-6">
              <div>
                <label className="block text-xs font-medium text-brand-muted mb-1.5 uppercase tracking-wide">
                  Specialty
                </label>
                <select
                  value={specialty}
                  onChange={(e) => setSpecialty(e.target.value)}
                  className="w-full px-3 py-2.5 bg-brand-bg border border-brand-border rounded-lg text-sm text-brand-text outline-none focus:border-brand-accent/45 transition-all"
                >
                  <option value="">Select specialty…</option>
                  {SPECIALTIES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-brand-muted mb-1.5 uppercase tracking-wide">
                  Subspecialty (optional)
                </label>
                <input
                  type="text"
                  value={subspecialty}
                  onChange={(e) => setSubspecialty(e.target.value)}
                  placeholder="e.g. Neonatology, Interventional Cardiology"
                  className="w-full px-3 py-2.5 bg-brand-bg border border-brand-border rounded-lg text-sm text-brand-text placeholder-brand-subtle outline-none focus:border-brand-accent/45 transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-brand-muted mb-1.5 uppercase tracking-wide">
                  Hospital / Institution (optional)
                </label>
                <input
                  type="text"
                  value={institution}
                  onChange={(e) => setInstitution(e.target.value)}
                  placeholder="Kenyatta National Hospital"
                  className="w-full px-3 py-2.5 bg-brand-bg border border-brand-border rounded-lg text-sm text-brand-text placeholder-brand-subtle outline-none focus:border-brand-accent/45 transition-all"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-brand-muted mb-1.5 uppercase tracking-wide">
                    Years of experience
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="60"
                    value={yearsExp}
                    onChange={(e) => setYearsExp(e.target.value)}
                    placeholder="5"
                    className="w-full px-3 py-2.5 bg-brand-bg border border-brand-border rounded-lg text-sm text-brand-text placeholder-brand-subtle outline-none focus:border-brand-accent/45 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-brand-muted mb-1.5 uppercase tracking-wide">
                    Medical licence # (optional)
                  </label>
                  <input
                    type="text"
                    value={medLicense}
                    onChange={(e) => setMedLicense(e.target.value)}
                    placeholder="KMD/XXXX"
                    className="w-full px-3 py-2.5 bg-brand-bg border border-brand-border rounded-lg text-sm text-brand-text placeholder-brand-subtle outline-none focus:border-brand-accent/45 transition-all"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setStep(1)} className="flex-1 py-3 text-sm text-brand-muted border border-brand-border rounded-xl hover:text-brand-text transition-colors">
                ← Back
              </button>
              <button onClick={() => setStep(3)} className="flex-1 py-3 text-sm font-semibold text-white bg-brand-accent hover:bg-brand-accent-hover rounded-xl transition-colors">
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Interests */}
        {step === 3 && (
          <div className="animate-fadeIn">
            <h1 className="text-2xl font-bold text-brand-text mb-2">Your Interests</h1>
            <p className="text-brand-muted text-sm mb-8">
              Select topics to personalise your feed. You can change these anytime.
            </p>
            <div className="bg-brand-surface border border-brand-border rounded-2xl p-6">
              <div className="flex flex-wrap gap-2 mb-4">
                {INTERESTS.map((interest) => (
                  <button
                    key={interest}
                    type="button"
                    onClick={() => toggleInterest(interest)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                      interests.includes(interest)
                        ? 'bg-brand-accent/15 text-brand-accent border-brand-accent/40'
                        : 'text-brand-muted border-brand-border hover:border-brand-border/80 hover:text-brand-text'
                    }`}
                  >
                    {interest}
                  </button>
                ))}
              </div>
              <div>
                <label className="block text-xs font-medium text-brand-muted mb-1.5 uppercase tracking-wide">
                  Bio (optional)
                </label>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Briefly describe your clinical focus or what you hope to share with the community…"
                  rows={3}
                  className="w-full px-3 py-2.5 bg-brand-bg border border-brand-border rounded-lg text-sm text-brand-text placeholder-brand-subtle resize-none outline-none focus:border-brand-accent/45 transition-all"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setStep(2)} className="flex-1 py-3 text-sm text-brand-muted border border-brand-border rounded-xl hover:text-brand-text transition-colors">
                ← Back
              </button>
              <button onClick={() => setStep(4)} className="flex-1 py-3 text-sm font-semibold text-white bg-brand-accent hover:bg-brand-accent-hover rounded-xl transition-colors">
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Finish */}
        {step === 4 && (
          <div className="animate-fadeIn">
            <h1 className="text-2xl font-bold text-brand-text mb-2">You&apos;re all set!</h1>
            <p className="text-brand-muted text-sm mb-8">
              Review your details and join the community.
            </p>
            <div className="bg-brand-surface border border-brand-border rounded-2xl p-6 space-y-3">
              <Row label="Name" value={displayName} />
              <Row label="Country" value={country} />
              {specialty && <Row label="Specialty" value={specialty} />}
              {institution && <Row label="Institution" value={institution} />}
              {yearsExp && <Row label="Experience" value={`${yearsExp} years`} />}
              {interests.length > 0 && (
                <div className="flex items-start gap-2">
                  <span className="text-xs text-brand-muted w-24 flex-shrink-0 pt-0.5">Interests</span>
                  <div className="flex flex-wrap gap-1">
                    {interests.map((i) => (
                      <span key={i} className="text-[11px] bg-brand-raised border border-brand-border rounded-full px-2 py-0.5 text-brand-muted">{i}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {error && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg mt-4">
                {error}
              </p>
            )}
            <div className="flex gap-3 mt-6">
              <button onClick={() => setStep(3)} className="flex-1 py-3 text-sm text-brand-muted border border-brand-border rounded-xl hover:text-brand-text transition-colors">
                ← Back
              </button>
              <button
                onClick={handleFinish}
                disabled={loading}
                className="flex-1 py-3 text-sm font-semibold text-white bg-brand-accent hover:bg-brand-accent-hover disabled:opacity-50 rounded-xl transition-colors shadow-[0_0_28px_-6px_rgba(168,85,247,0.55)]"
              >
                {loading ? 'Setting up…' : 'Join Community →'}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-brand-muted w-24 flex-shrink-0">{label}</span>
      <span className="text-sm text-brand-text">{value}</span>
    </div>
  )
}
