'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, getAccessToken } from '@/lib/supabase'
import { streamSearch } from '@/lib/api'
import Navbar from '@/components/Navbar'
import SearchBar from '@/components/SearchBar'
import AnswerCard from '@/components/AnswerCard'
import type { Citation, SearchState } from '@/types'

const INITIAL_STATE: SearchState = {
  status: 'idle',
  statusMessage: '',
  answer: '',
  citations: [],
  evidence_grade: '',
  error: null,
}

const SAMPLE_QUERIES = [
  'First-line malaria treatment in adults',
  'Managing postpartum haemorrhage',
  'Severe malnutrition in under-5s',
  'HIV in pregnancy — ARV regimen',
]

function Dots({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2.5 text-sm text-[#6b6b6b] py-4">
      <span className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 bg-teal-500 rounded-full animate-bounce"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </span>
      <span>{message}</span>
    </div>
  )
}

export default function HomePage() {
  const router = useRouter()
  const [state, setState] = useState<SearchState>(INITIAL_STATE)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.push('/auth/login')
    })
  }, [router])

  async function handleSearch(query: string) {
    setState({ ...INITIAL_STATE, status: 'searching', statusMessage: 'Searching guidelines…' })

    const token = await getAccessToken()
    if (!token) { router.push('/auth/login'); return }

    try {
      for await (const event of streamSearch(query, token)) {
        if (event.event === 'status') {
          setState((prev) => ({ ...prev, statusMessage: event.data.message }))
        } else if (event.event === 'citations') {
          setState((prev) => ({
            ...prev,
            status: 'streaming',
            citations: event.data.citations,
            evidence_grade: event.data.evidence_grade,
          }))
        } else if (event.event === 'token') {
          setState((prev) => ({ ...prev, answer: prev.answer + event.data.token }))
        } else if (event.event === 'done') {
          setState((prev) => {
            const { answer, citations } = renumberByAppearance(prev.answer, prev.citations)
            return { ...prev, status: 'done', answer, citations }
          })
        } else if (event.event === 'error') {
          setState((prev) => ({ ...prev, status: 'error', error: event.data.detail }))
        }
      }
    } catch (err) {
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: err instanceof Error ? err.message : 'An unexpected error occurred.',
      }))
    }
  }

  const isLoading = state.status === 'searching' || state.status === 'streaming'
  const hasResult = state.status !== 'idle'

  return (
    <div className="min-h-screen bg-[#0f0f0f]">
      <Navbar />

      <main className="flex flex-col items-center px-4 pt-14">
        {/* Hero — collapses when results are present */}
        <div className={`w-full max-w-2xl flex flex-col items-center transition-all duration-500 ${hasResult ? 'pt-12 pb-8' : 'pt-32 pb-10'}`}>
          {!hasResult && (
            <div className="text-center mb-10">
              <h1 className="text-4xl font-bold text-white tracking-tight mb-3">Qwiva</h1>
              <p className="text-[#6b6b6b] text-base">
                Kenya's clinical knowledge platform
              </p>
            </div>
          )}

          <SearchBar onSearch={handleSearch} isLoading={isLoading} />

          {/* Query chips — only when idle */}
          {!hasResult && (
            <div className="flex flex-wrap justify-center gap-2 mt-5">
              {SAMPLE_QUERIES.map((q) => (
                <button
                  key={q}
                  onClick={() => handleSearch(q)}
                  className="px-3.5 py-1.5 text-xs text-[#9a9a9a] bg-[#1a1a1a] border border-[#2a2a2a] rounded-full hover:border-teal-500/40 hover:text-teal-400 transition-all"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Result area */}
        {hasResult && (
          <div className="w-full max-w-2xl pb-24">
            {/* Divider */}
            <div className="h-px bg-[#2a2a2a] mb-8" />

            {state.status === 'searching' && (
              <Dots message={state.statusMessage} />
            )}

            {(state.status === 'streaming' || state.status === 'done') && (
              <AnswerCard
                answer={state.answer}
                citations={state.citations}
                isStreaming={state.status === 'streaming'}
                isDone={state.status === 'done'}
              />
            )}

            {state.status === 'error' && (
              <p className="text-sm text-red-400 py-4">{state.error}</p>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Renumber citations by order of first appearance in the answer text.
// e.g. if LLM writes "[3] ... [1] ... [2]", renumber to [1] [2] [3].
// ---------------------------------------------------------------------------

function renumberByAppearance(
  answer: string,
  citations: Citation[],
): { answer: string; citations: Citation[] } {
  const order: number[] = []
  const regex = /\[(\d+)\]/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(answer)) !== null) {
    const n = parseInt(match[1])
    if (!order.includes(n)) order.push(n)
  }

  // Build old → new index map
  const remap: Record<number, number> = {}
  order.forEach((oldIdx, i) => { remap[oldIdx] = i + 1 })
  // Any citations not cited in text get appended in original order
  citations.forEach((c) => {
    if (!(c.index in remap)) {
      remap[c.index] = Object.keys(remap).length + 1
    }
  })

  const newAnswer = answer.replace(/\[(\d+)\]/g, (_, n) => `[${remap[parseInt(n)] ?? n}]`)
  const newCitations = citations
    .map((c) => ({ ...c, index: remap[c.index] ?? c.index }))
    .sort((a, b) => a.index - b.index)

  return { answer: newAnswer, citations: newCitations }
}
