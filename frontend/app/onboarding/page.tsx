'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, getAccessToken } from '@/lib/supabase'
import { completeOnboarding } from '@/lib/api'

type Cadre = 'Medical Practitioner' | 'Clinical Officer' | 'Dental Practitioner' | 'Intern'

const CADRES: { value: Cadre; label: string; icon: string; regLabel: string; regPlaceholder: string; regPattern: RegExp }[] = [
  {
    value: 'Medical Practitioner',
    label: 'Medical Practitioner',
    icon: '🩺',
    regLabel: 'KMPDC Registration No.',
    regPlaceholder: 'e.g. A35671',
    regPattern: /^[Aa]\d{4,5}$/,
  },
  {
    value: 'Clinical Officer',
    label: 'Clinical Officer',
    icon: '📋',
    regLabel: 'COC Licence Number',
    regPlaceholder: 'e.g. Rd02177/25',
    regPattern: /^[A-Za-z]{1,3}\d{3,6}\/\d{2}$/,
  },
  {
    value: 'Dental Practitioner',
    label: 'Dental Practitioner',
    icon: '🦷',
    regLabel: 'KMPDC Registration No.',
    regPlaceholder: 'e.g. B10234',
    regPattern: /^[Bb]\d{4,5}$/,
  },
  {
    value: 'Intern',
    label: 'Intern',
    icon: '🎓',
    regLabel: 'KMPDC Intern Licence No.',
    regPlaceholder: 'e.g. 92000',
    regPattern: /^\d{5}$/,
  },
]

const SPECIALTIES_BY_CADRE: Record<string, string[]> = {
  'Medical Practitioner': [
    'General Practice', 'Internal Medicine', 'Paediatrics', 'Surgery',
    'Obs & Gynaecology', 'Anaesthesia & Critical Care', 'Emergency Medicine',
    'Psychiatry', 'Oncology', 'Ophthalmology', 'ENT', 'Dermatology',
    'Family Medicine', 'Radiology', 'Pathology', 'Public Health', 'Infectious Disease',
  ],
  'Clinical Officer': [
    'General Clinical Medicine', 'Anaesthesia', 'Orthopaedics', 'ENT',
    'Ophthalmology', 'Paediatrics', 'Reproductive Health', 'Mental Health', 'Surgical',
  ],
  'Dental Practitioner': [
    'General Dentistry', 'Oral Surgery', 'Orthodontics', 'Paediatric Dentistry',
    'Periodontics', 'Prosthodontics', 'Restorative Dentistry', 'Oral Pathology', 'Conservative Dentistry',
  ],
}

const ROTATIONS = [
  'Internal Medicine', 'Surgery', 'Paediatrics', 'Obs & Gynaecology',
  'Psychiatry', 'Emergency Medicine', 'Anaesthesia', 'Community Health',
  'Orthopaedics', 'ENT', 'Ophthalmology', 'Dermatology',
  'Radiology', 'Pathology', 'Family Medicine',
]

const MAX_SELECTIONS = 3
const TOTAL_STEPS = 3

type Country = { name: string; flag: string; dial: string }

const COUNTRIES: Country[] = [
  { name: 'Kenya', flag: '🇰🇪', dial: '+254' },
  { name: 'Uganda', flag: '🇺🇬', dial: '+256' },
  { name: 'Tanzania', flag: '🇹🇿', dial: '+255' },
  { name: 'Rwanda', flag: '🇷🇼', dial: '+250' },
  { name: 'Ethiopia', flag: '🇪🇹', dial: '+251' },
  { name: 'South Sudan', flag: '🇸🇸', dial: '+211' },
  { name: 'Burundi', flag: '🇧🇮', dial: '+257' },
  { name: 'Somalia', flag: '🇸🇴', dial: '+252' },
  { name: 'Argentina', flag: '🇦🇷', dial: '+54' },
  { name: 'Australia', flag: '🇦🇺', dial: '+61' },
  { name: 'Austria', flag: '🇦🇹', dial: '+43' },
  { name: 'Belgium', flag: '🇧🇪', dial: '+32' },
  { name: 'Brazil', flag: '🇧🇷', dial: '+55' },
  { name: 'Cameroon', flag: '🇨🇲', dial: '+237' },
  { name: 'Canada', flag: '🇨🇦', dial: '+1' },
  { name: 'China', flag: '🇨🇳', dial: '+86' },
  { name: 'Denmark', flag: '🇩🇰', dial: '+45' },
  { name: 'Egypt', flag: '🇪🇬', dial: '+20' },
  { name: 'Finland', flag: '🇫🇮', dial: '+358' },
  { name: 'France', flag: '🇫🇷', dial: '+33' },
  { name: 'Germany', flag: '🇩🇪', dial: '+49' },
  { name: 'Ghana', flag: '🇬🇭', dial: '+233' },
  { name: 'India', flag: '🇮🇳', dial: '+91' },
  { name: 'Indonesia', flag: '🇮🇩', dial: '+62' },
  { name: 'Ireland', flag: '🇮🇪', dial: '+353' },
  { name: 'Italy', flag: '🇮🇹', dial: '+39' },
  { name: 'Japan', flag: '🇯🇵', dial: '+81' },
  { name: 'Malaysia', flag: '🇲🇾', dial: '+60' },
  { name: 'Mexico', flag: '🇲🇽', dial: '+52' },
  { name: 'Morocco', flag: '🇲🇦', dial: '+212' },
  { name: 'Netherlands', flag: '🇳🇱', dial: '+31' },
  { name: 'New Zealand', flag: '🇳🇿', dial: '+64' },
  { name: 'Nigeria', flag: '🇳🇬', dial: '+234' },
  { name: 'Norway', flag: '🇳🇴', dial: '+47' },
  { name: 'Pakistan', flag: '🇵🇰', dial: '+92' },
  { name: 'Philippines', flag: '🇵🇭', dial: '+63' },
  { name: 'Poland', flag: '🇵🇱', dial: '+48' },
  { name: 'Portugal', flag: '🇵🇹', dial: '+351' },
  { name: 'Saudi Arabia', flag: '🇸🇦', dial: '+966' },
  { name: 'Senegal', flag: '🇸🇳', dial: '+221' },
  { name: 'Singapore', flag: '🇸🇬', dial: '+65' },
  { name: 'South Africa', flag: '🇿🇦', dial: '+27' },
  { name: 'Spain', flag: '🇪🇸', dial: '+34' },
  { name: 'Sweden', flag: '🇸🇪', dial: '+46' },
  { name: 'Switzerland', flag: '🇨🇭', dial: '+41' },
  { name: 'UAE', flag: '🇦🇪', dial: '+971' },
  { name: 'United Kingdom', flag: '🇬🇧', dial: '+44' },
  { name: 'United States', flag: '🇺🇸', dial: '+1' },
]

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // Step 1: Phone + country
  const [country, setCountry] = useState<Country>(COUNTRIES[0])
  const [phone, setPhone] = useState('')
  const [showCountryPicker, setShowCountryPicker] = useState(false)
  const [countrySearch, setCountrySearch] = useState('')

  // Step 2: Cadre + registration
  const [cadre, setCadre] = useState<Cadre | null>(null)
  const [regNumber, setRegNumber] = useState('')

  // Step 3: Specialties or rotation
  const [selected, setSelected] = useState<string[]>([])
  const [specialtySearch, setSpecialtySearch] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/auth/login'); return }
      // If they've already onboarded, send them home — onboarding is no longer
      // the place to edit their profile.
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('onboarding_complete')
        .eq('user_id', data.session.user.id)
        .maybeSingle()
      if (profile?.onboarding_complete) router.replace('/')
    })
  }, [router])

  // Reset step-3 selections when cadre changes
  useEffect(() => { setSelected([]) }, [cadre])

  const cadreConfig = cadre ? CADRES.find(c => c.value === cadre) : null
  const cleanedPhone = phone.replace(/\s/g, '').replace(/^0/, '')
  const fullPhone = `${country.dial}${cleanedPhone}`
  const phoneValid = cleanedPhone.length >= 7
  const regValid = cadreConfig ? cadreConfig.regPattern.test(regNumber.trim()) : false

  const filteredCountries = countrySearch.trim()
    ? COUNTRIES.filter(c =>
        c.name.toLowerCase().includes(countrySearch.toLowerCase())
        || c.dial.includes(countrySearch)
      )
    : COUNTRIES

  const isIntern = cadre === 'Intern'
  const listForCadre = cadre && !isIntern ? (SPECIALTIES_BY_CADRE[cadre] ?? []) : ROTATIONS
  const filteredList = specialtySearch.trim()
    ? listForCadre.filter(s => s.toLowerCase().includes(specialtySearch.toLowerCase()))
    : listForCadre

  function toggleItem(label: string) {
    setSelected(prev => {
      if (prev.includes(label)) return prev.filter(s => s !== label)
      if (prev.length >= MAX_SELECTIONS) return prev
      return [...prev, label]
    })
  }

  async function handleFinish() {
    if (selected.length === 0) return
    setLoading(true)
    setError(null)
    try {
      const token = await getAccessToken()
      if (!token) { router.push('/auth/login'); return }
      await completeOnboarding({
        phone: fullPhone,
        cadre,
        registration_number: regNumber.trim(),
        specialties: !isIntern ? selected : [],
        current_rotation: isIntern ? selected : [],
        country: country.name,
        languages: [],
        interests: [],
      }, token)
      setDone(true)
      setTimeout(() => router.push('/'), 1200)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <main className="min-h-screen bg-brand-bg flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">✓</div>
          <h1 className="text-xl font-bold text-brand-text">You&apos;re all set!</h1>
          <p className="text-brand-muted mt-2 text-sm">Taking you to Qwiva…</p>
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
          <div className="flex gap-1.5">
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full transition-all duration-500 ${
                  i < step ? 'bg-brand-accent' : 'bg-brand-border'
                }`}
              />
            ))}
          </div>
        </div>

        {/* ── Step 1: Phone ── */}
        {step === 1 && (
          <div className="animate-fadeIn">
            <h1 className="text-2xl font-bold text-brand-text mb-1">What&apos;s your phone number?</h1>
            <p className="text-brand-muted text-sm mb-8">
              We&apos;ll use this to reach you about your account.
            </p>

            <div className="bg-brand-surface border border-brand-border rounded-2xl p-6">
              <label className="block text-xs font-medium text-brand-muted mb-2 uppercase tracking-wide">
                Country
              </label>
              <button
                type="button"
                onClick={() => { setCountrySearch(''); setShowCountryPicker(true) }}
                className="w-full flex items-center justify-between gap-3 mb-4 px-4 py-2.5 bg-brand-bg border border-brand-border rounded-xl text-sm text-brand-text outline-none hover:border-brand-accent/45 focus:border-brand-accent/45 transition-all"
              >
                <span className="flex items-center gap-2">
                  <span className="text-base">{country.flag}</span>
                  <span>{country.name}</span>
                  <span className="text-brand-muted">{country.dial}</span>
                </span>
                <span className="text-brand-muted">▾</span>
              </button>
              <label className="block text-xs font-medium text-brand-muted mb-2 uppercase tracking-wide">
                Phone number
              </label>
              <div className="flex gap-2">
                <span className="px-3 py-2.5 bg-brand-bg border border-brand-border rounded-xl text-sm text-brand-text whitespace-nowrap flex items-center gap-1.5">
                  <span>{country.flag}</span>
                  <span className="font-medium">{country.dial}</span>
                </span>
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="712 548 901"
                  autoFocus
                  className="flex-1 px-4 py-2.5 bg-brand-bg border border-brand-border rounded-xl text-sm text-brand-text placeholder-brand-subtle outline-none focus:border-brand-accent/45 transition-all"
                />
              </div>
            </div>

            <button
              onClick={() => phoneValid && setStep(2)}
              disabled={!phoneValid}
              className="w-full mt-6 py-3 text-sm font-semibold text-white bg-brand-accent hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl transition-all"
            >
              Continue →
            </button>
          </div>
        )}

        {/* ── Step 2: Cadre + Registration ── */}
        {step === 2 && (
          <div className="animate-fadeIn">
            <h1 className="text-2xl font-bold text-brand-text mb-1">Tell us about your practice.</h1>
            <p className="text-brand-muted text-sm mb-8">
              This helps us tailor your CPD tracking and evidence feed to your clinical role.
            </p>

            <div className="bg-brand-surface border border-brand-border rounded-2xl p-6 space-y-5">
              <div>
                <label className="block text-xs font-medium text-brand-muted mb-3 uppercase tracking-wide">
                  Your cadre
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {CADRES.map(c => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => { setCadre(c.value); setRegNumber('') }}
                      className={`flex flex-col items-start gap-2 p-4 rounded-xl border-2 text-left transition-all ${
                        cadre === c.value
                          ? 'border-brand-accent bg-brand-accent/5 shadow-[0_4px_16px_-4px_rgba(168,85,247,0.25)]'
                          : 'border-brand-border bg-brand-bg hover:border-brand-accent/40'
                      }`}
                    >
                      <span className="text-xl">{c.icon}</span>
                      <span className={`text-sm font-medium leading-tight ${cadre === c.value ? 'text-brand-accent' : 'text-brand-text'}`}>
                        {c.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {cadreConfig && (
                <div>
                  <label className="block text-xs font-medium text-brand-muted mb-1.5 uppercase tracking-wide">
                    {cadreConfig.regLabel}
                  </label>
                  <input
                    type="text"
                    value={regNumber}
                    onChange={e => setRegNumber(e.target.value)}
                    placeholder={cadreConfig.regPlaceholder}
                    autoCapitalize="none"
                    className="w-full px-4 py-2.5 bg-brand-bg border border-brand-border rounded-xl text-sm text-brand-text placeholder-brand-subtle outline-none focus:border-brand-accent/45 transition-all"
                  />
                  {regNumber && !regValid && (
                    <p className="text-xs text-red-400 mt-1.5">
                      Format: {cadreConfig.regPlaceholder}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setStep(1)}
                className="flex-1 py-3 text-sm text-brand-muted border border-brand-border rounded-xl hover:text-brand-text transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={() => (cadre && regValid) && setStep(3)}
                disabled={!cadre || !regValid}
                className="flex-1 py-3 text-sm font-semibold text-white bg-brand-accent hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl transition-all"
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Specialties or Rotation ── */}
        {step === 3 && (
          <div className="animate-fadeIn">
            <h1 className="text-2xl font-bold text-brand-text mb-1">
              {isIntern ? 'Which rotation are you in?' : 'What is your speciality?'}
            </h1>
            <p className="text-brand-muted text-sm mb-6">
              {isIntern
                ? "Choose up to 3. We'll tailor your cases and evidence to what you're seeing right now."
                : "Pick up to three. You'll see more evidence and CME in these areas."}
            </p>

            {/* Search (non-intern only since rotation list is short) */}
            {!isIntern && (
              <input
                type="text"
                value={specialtySearch}
                onChange={e => setSpecialtySearch(e.target.value)}
                placeholder="Search specialties…"
                className="w-full px-4 py-2.5 mb-4 bg-brand-surface border border-brand-border rounded-xl text-sm text-brand-text placeholder-brand-subtle outline-none focus:border-brand-accent/45 transition-all"
              />
            )}

            <div className="flex flex-wrap gap-2 mb-5">
              {filteredList.map(label => {
                const active = selected.includes(label)
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => toggleItem(label)}
                    className={`text-sm px-3.5 py-2 rounded-full border transition-all ${
                      active
                        ? 'bg-brand-accent/15 text-brand-accent border-brand-accent/50 font-medium'
                        : 'text-brand-muted border-brand-border hover:border-brand-accent/30 hover:text-brand-text bg-brand-surface'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
              {filteredList.length === 0 && (
                <p className="text-sm text-brand-muted py-4">No results for &quot;{specialtySearch}&quot;</p>
              )}
            </div>

            <p className="text-xs text-brand-muted mb-6">
              {selected.length} of {MAX_SELECTIONS} selected
              {selected.length === MAX_SELECTIONS && ' · max reached'}
            </p>

            {error && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg mb-4">
                {error}
              </p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setStep(2)}
                className="flex-1 py-3 text-sm text-brand-muted border border-brand-border rounded-xl hover:text-brand-text transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={handleFinish}
                disabled={selected.length === 0 || loading}
                className="flex-1 py-3 text-sm font-semibold text-white bg-brand-accent hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl transition-all"
              >
                {loading ? 'Setting up…' : `Continue${selected.length > 0 ? ` with ${selected.length} selected` : ''}`}
              </button>
            </div>
          </div>
        )}
      </div>

      {showCountryPicker && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setShowCountryPicker(false)}
        >
          <div
            className="w-full sm:max-w-md bg-brand-surface border border-brand-border rounded-t-2xl sm:rounded-2xl max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-brand-border">
              <h2 className="text-base font-semibold text-brand-text">Select country</h2>
              <button
                type="button"
                onClick={() => setShowCountryPicker(false)}
                className="text-sm font-medium text-brand-accent"
              >
                Done
              </button>
            </div>
            <div className="px-5 py-3 border-b border-brand-border">
              <input
                type="text"
                placeholder="Search country or code"
                value={countrySearch}
                onChange={(e) => setCountrySearch(e.target.value)}
                autoFocus
                className="w-full px-3 py-2 bg-brand-bg border border-brand-border rounded-lg text-sm text-brand-text placeholder-brand-subtle outline-none focus:border-brand-accent/45"
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {filteredCountries.map(c => {
                const active = c.name === country.name
                return (
                  <button
                    key={c.dial + c.name}
                    type="button"
                    onClick={() => { setCountry(c); setShowCountryPicker(false) }}
                    className={`w-full flex items-center gap-3 px-5 py-3 text-left transition-colors ${
                      active ? 'bg-brand-accent/10' : 'hover:bg-brand-bg'
                    }`}
                  >
                    <span className="text-xl">{c.flag}</span>
                    <span className="flex-1 text-sm text-brand-text">{c.name}</span>
                    <span className="text-xs text-brand-muted">{c.dial}</span>
                  </button>
                )
              })}
              {filteredCountries.length === 0 && (
                <p className="text-center text-sm text-brand-muted py-8">
                  No matches for &quot;{countrySearch}&quot;
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
