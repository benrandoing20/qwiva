'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Navbar from '@/components/Navbar'

// ---------------------------------------------------------------------------
// Mock data — replace with real API calls once backend is wired
// ---------------------------------------------------------------------------

const MOCK_STATS = {
  xp: 1340,
  streakDays: 7,
  cmeCredits: 2.68,
  cmeRequired: 40,
}

const MOCK_LESSONS = [
  {
    id: '1',
    title: 'First-line malaria treatment in adults',
    guideline: 'Kenya Clinical Guidelines 2022',
    questions: 10,
    minutesEst: 10,
    xpReward: 50,
    difficulty: 2,
    reason: 'Based on your recent searches',
  },
  {
    id: '2',
    title: 'Managing postpartum haemorrhage',
    guideline: 'WHO Recommendations on Prevention and Treatment of PPH',
    questions: 10,
    minutesEst: 10,
    xpReward: 50,
    difficulty: 3,
    reason: 'Due for review',
  },
  {
    id: '3',
    title: 'HIV in pregnancy — ARV regimen selection',
    guideline: 'Kenya ARV Guidelines 2022',
    questions: 10,
    minutesEst: 10,
    xpReward: 50,
    difficulty: 3,
    reason: 'Based on your recent searches',
  },
]

const LEARNING_TRACKS = [
  {
    id: 'maternal-health',
    title: 'Maternal & Neonatal Health',
    description: 'ANC, labour, PPH, neonatal resuscitation, ARVs in pregnancy',
    lessons: 24,
    credits: 8,
  },
  {
    id: 'infectious-disease',
    title: 'Infectious Disease',
    description: 'Malaria, TB, HIV, sepsis, antimicrobial stewardship',
    lessons: 32,
    credits: 10,
  },
  {
    id: 'paediatrics',
    title: 'Paediatrics',
    description: 'Acute illness in under-5s, malnutrition, immunisation',
    lessons: 28,
    credits: 9,
  },
  {
    id: 'emergency-medicine',
    title: 'Emergency Medicine',
    description: 'Trauma, ACS, stroke, poisoning, resuscitation',
    lessons: 20,
    credits: 7,
  },
  {
    id: 'non-communicable',
    title: 'Non-Communicable Disease',
    description: 'Hypertension, diabetes, CKD, heart failure',
    lessons: 22,
    credits: 7,
  },
  {
    id: 'surgical',
    title: 'Surgical & Perioperative Care',
    description: 'Pre-op assessment, wound care, post-op complications',
    lessons: 16,
    credits: 5,
  },
]

const XP_PER_CREDIT = 500
const CME_REQUIRED = 40

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LearnPage() {
  const router = useRouter()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.push('/auth/login')
    })
  }, [router])

  const { xp, streakDays, cmeCredits } = MOCK_STATS
  const xpInCurrentCredit = xp % XP_PER_CREDIT
  const creditPct = Math.min((cmeCredits / CME_REQUIRED) * 100, 100)
  const xpPct = (xpInCurrentCredit / XP_PER_CREDIT) * 100

  return (
    <div className="min-h-screen bg-[#0f0f0f]">
      <Navbar />

      <main className="max-w-3xl mx-auto px-6 pt-24 pb-32">

        {/* ------------------------------------------------------------------ */}
        {/* Hero */}
        {/* ------------------------------------------------------------------ */}
        <div className="pt-10 pb-12 border-b border-[#1a1a1a]">
          <p className="text-xs text-teal-500 uppercase tracking-widest font-semibold mb-3">
            Learning Hub
          </p>
          <h1 className="text-3xl font-bold text-white tracking-tight leading-snug mb-4">
            Turn clinical lookups<br />into CME credits.
          </h1>
          <p className="text-[#6b6b6b] text-sm leading-relaxed max-w-lg">
            Each lesson is built from the same guidelines you search every day.
            Complete structured tracks to build verifiable competency across a specialty —
            not just isolated facts.
          </p>
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* Progress */}
        {/* ------------------------------------------------------------------ */}
        <div className="py-10 border-b border-[#1a1a1a]">
          <div className="flex items-center justify-between mb-6">
            <p className="text-xs font-semibold text-[#6b6b6b] uppercase tracking-widest">
              Your progress
            </p>
            <div className="flex items-center gap-5 text-xs text-[#6b6b6b]">
              <span>
                <span className="text-white font-semibold">{streakDays}</span> day streak
              </span>
              <span>
                <span className="text-white font-semibold">{xp.toLocaleString()}</span> XP total
              </span>
            </div>
          </div>

          {/* CME bar */}
          <div className="mb-6">
            <div className="flex items-end justify-between mb-2">
              <div>
                <span className="text-2xl font-bold text-white">{cmeCredits.toFixed(1)}</span>
                <span className="text-sm text-[#6b6b6b] ml-2">of {CME_REQUIRED} CME credits</span>
              </div>
              <span className="text-xs text-[#4a4a4a]">
                {(CME_REQUIRED - cmeCredits).toFixed(1)} remaining
              </span>
            </div>
            <div className="w-full h-2 bg-[#1a1a1a] rounded-full overflow-hidden">
              <div
                className="h-full bg-teal-500 rounded-full transition-all duration-700"
                style={{ width: `${creditPct}%` }}
              />
            </div>
            <p className="text-xs text-[#4a4a4a] mt-2">Kenya MPDC annual requirement</p>
          </div>

          {/* XP to next credit */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-[#6b6b6b]">Next credit</p>
              <p className="text-xs text-[#4a4a4a]">{xpInCurrentCredit} / {XP_PER_CREDIT} XP</p>
            </div>
            <div className="w-full h-1 bg-[#1a1a1a] rounded-full overflow-hidden">
              <div
                className="h-full bg-teal-500/60 rounded-full transition-all duration-700"
                style={{ width: `${xpPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* Learning tracks */}
        {/* ------------------------------------------------------------------ */}
        <div className="py-10 border-b border-[#1a1a1a]">
          <div className="mb-8">
            <p className="text-xs font-semibold text-[#6b6b6b] uppercase tracking-widest mb-2">
              Learning Tracks
            </p>
            <p className="text-sm text-[#4a4a4a] leading-relaxed">
              Structured sequences covering a full clinical domain. Complete a track to demonstrate
              competency across a specialty — not just individual topics.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {LEARNING_TRACKS.map((track) => (
              <div
                key={track.id}
                className="group relative bg-[#111111] border border-[#1e1e1e] rounded-2xl px-5 py-5 flex flex-col gap-3"
              >
                {/* Lock indicator */}
                <div className="absolute top-4 right-4">
                  <div className="w-4 h-4 text-[#2a2a2a]">
                    <svg viewBox="0 0 16 16" fill="currentColor">
                      <path d="M11 7V5a3 3 0 0 0-6 0v2H4v7h8V7h-1zm-5-2a2 2 0 0 1 4 0v2H6V5z" />
                    </svg>
                  </div>
                </div>

                <div className="pr-6">
                  <p className="text-sm font-semibold text-[#6b6b6b] leading-snug mb-1">
                    {track.title}
                  </p>
                  <p className="text-xs text-[#3a3a3a] leading-relaxed">
                    {track.description}
                  </p>
                </div>

                <div className="flex items-center gap-3 text-xs text-[#3a3a3a]">
                  <span>{track.lessons} lessons</span>
                  <span className="w-px h-3 bg-[#2a2a2a]" />
                  <span>{track.credits} credits</span>
                </div>

                <div className="mt-auto pt-1">
                  <span className="text-xs text-[#2a2a2a] font-medium">Coming soon</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* Today's picks */}
        {/* ------------------------------------------------------------------ */}
        <div className="py-10 border-b border-[#1a1a1a]">
          <div className="flex items-center justify-between mb-6">
            <p className="text-xs font-semibold text-[#6b6b6b] uppercase tracking-widest">
              Recommended for you
            </p>
            <p className="text-xs text-[#3a3a3a]">Based on search history</p>
          </div>

          <div className="space-y-2">
            {MOCK_LESSONS.map((lesson) => (
              <div
                key={lesson.id}
                className="flex items-start justify-between gap-4 bg-[#111111] border border-[#1e1e1e] rounded-2xl px-5 py-4"
              >
                <div className="min-w-0">
                  <p className="text-sm text-[#6b6b6b] font-medium leading-snug mb-1">
                    {lesson.title}
                  </p>
                  <div className="flex items-center gap-3 text-xs text-[#3a3a3a]">
                    <span>{lesson.questions} questions</span>
                    <span className="w-px h-3 bg-[#2a2a2a]" />
                    <span>{lesson.minutesEst} min</span>
                    <span className="w-px h-3 bg-[#2a2a2a]" />
                    <span>{lesson.reason}</span>
                  </div>
                </div>
                <div className="flex-shrink-0 flex flex-col items-end gap-2">
                  <span className="text-xs text-teal-500/60">+{lesson.xpReward} XP</span>
                  <span className="text-xs text-[#2a2a2a] font-medium">Coming soon</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* Accreditation note */}
        {/* ------------------------------------------------------------------ */}
        <div className="pt-10">
          <p className="text-xs text-[#3a3a3a] leading-relaxed max-w-lg">
            Credits shown here track your learning progress within Qwiva.
            Formal CME accreditation from the Kenya Medical Practitioners and Dentists Council
            is being pursued — until complete, credits are for personal progress tracking only
            and do not satisfy official MPDC renewal requirements.
          </p>
        </div>

      </main>
    </div>
  )
}
