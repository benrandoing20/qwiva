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
  cmeCredits: 2.68,   // xp / 500
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
    reason: 'Due for review · Spaced repetition',
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

const XP_PER_CREDIT = 500
const CME_REQUIRED = 40

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl px-5 py-4">
      <p className="text-xs text-[#6b6b6b] uppercase tracking-widest mb-1">{label}</p>
      <p className="text-2xl font-bold text-white">{value}</p>
      {sub && <p className="text-xs text-[#6b6b6b] mt-0.5">{sub}</p>}
    </div>
  )
}

function CMEProgress({ credits, required }: { credits: number; required: number }) {
  const pct = Math.min((credits / required) * 100, 100)
  const remaining = Math.max(required - credits, 0)

  return (
    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl px-5 py-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-xs text-[#6b6b6b] uppercase tracking-widest mb-1">CME Credits</p>
          <p className="text-2xl font-bold text-white">
            {credits.toFixed(1)}
            <span className="text-sm font-normal text-[#6b6b6b] ml-1">/ {required} required</span>
          </p>
          <p className="text-xs text-[#6b6b6b] mt-0.5">Kenya MPDC annual requirement</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-teal-400">{remaining.toFixed(1)} remaining</p>
          <p className="text-xs text-[#6b6b6b] mt-0.5">≈ {Math.ceil(remaining / 12)} months at pace</p>
        </div>
      </div>
      <div className="w-full h-2 bg-[#2a2a2a] rounded-full overflow-hidden">
        <div
          className="h-full bg-teal-500 rounded-full transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-[#4a4a4a] mt-2">{pct.toFixed(1)}% of annual requirement complete</p>
    </div>
  )
}

function DifficultyDots({ level }: { level: number }) {
  return (
    <span className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`w-1.5 h-1.5 rounded-full ${i <= level ? 'bg-teal-500' : 'bg-[#2a2a2a]'}`}
        />
      ))}
    </span>
  )
}

function LessonCard({ lesson }: { lesson: typeof MOCK_LESSONS[0] }) {
  return (
    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl px-5 py-5 flex flex-col gap-3 hover:border-teal-500/30 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[#e8e8e8] leading-snug">{lesson.title}</p>
          <p className="text-xs text-[#4a4a4a] mt-1 truncate">{lesson.guideline}</p>
        </div>
        <span className="flex-shrink-0 text-xs text-teal-400 bg-teal-500/10 border border-teal-500/20 px-2 py-1 rounded-lg whitespace-nowrap">
          +{lesson.xpReward} XP
        </span>
      </div>

      <div className="flex items-center gap-4 text-xs text-[#6b6b6b]">
        <span>{lesson.questions} questions</span>
        <span>{lesson.minutesEst} min</span>
        <DifficultyDots level={lesson.difficulty} />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-[#4a4a4a] italic">{lesson.reason}</span>
        <button
          disabled
          className="text-xs font-semibold text-[#4a4a4a] bg-[#2a2a2a] px-3 py-1.5 rounded-lg cursor-not-allowed"
        >
          Coming soon
        </button>
      </div>
    </div>
  )
}

function XPToNextCredit({ xp }: { xp: number }) {
  const xpInCurrentCredit = xp % XP_PER_CREDIT
  const pct = (xpInCurrentCredit / XP_PER_CREDIT) * 100

  return (
    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl px-5 py-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-[#6b6b6b] uppercase tracking-widest">Next CME credit</p>
        <p className="text-xs text-[#6b6b6b]">{xpInCurrentCredit} / {XP_PER_CREDIT} XP</p>
      </div>
      <div className="w-full h-1.5 bg-[#2a2a2a] rounded-full overflow-hidden">
        <div
          className="h-full bg-teal-500 rounded-full transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

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

  return (
    <div className="min-h-screen bg-[#0f0f0f]">
      <Navbar />

      <main className="flex flex-col items-center px-4 pt-24 pb-24">
        <div className="w-full max-w-2xl space-y-6">

          {/* Header */}
          <div>
            <h1 className="text-xl font-semibold text-white">Learning Hub</h1>
            <p className="text-sm text-[#6b6b6b] mt-1">
              Earn CME credits through daily clinical lessons
            </p>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Total XP" value={xp.toLocaleString()} sub="500 XP = 1 credit" />
            <StatCard
              label="Streak"
              value={`${streakDays}d`}
              sub={streakDays >= 7 ? 'Weekly bonus active' : `${7 - streakDays}d to weekly bonus`}
            />
            <StatCard label="Credits" value={cmeCredits.toFixed(1)} sub="of 40 required" />
          </div>

          {/* CME progress */}
          <CMEProgress credits={cmeCredits} required={CME_REQUIRED} />

          {/* XP to next credit */}
          <XPToNextCredit xp={xp} />

          {/* Recommended lessons */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-[#6b6b6b] uppercase tracking-widest">
                Recommended for you
              </p>
              <p className="text-xs text-[#4a4a4a]">Based on search history</p>
            </div>
            <div className="space-y-3">
              {MOCK_LESSONS.map((lesson) => (
                <LessonCard key={lesson.id} lesson={lesson} />
              ))}
            </div>
          </div>

          {/* Accreditation notice */}
          <div className="bg-teal-500/5 border border-teal-500/15 rounded-2xl px-5 py-4">
            <p className="text-xs font-semibold text-teal-400 mb-1">CME Accreditation</p>
            <p className="text-xs text-[#6b6b6b] leading-relaxed">
              Formal accreditation from the Kenya Medical Practitioners and Dentists Council
              is in progress (18–24 month pathway). Credits earned now will be retroactively
              recognised upon accreditation.
            </p>
          </div>

        </div>
      </main>
    </div>
  )
}
