'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, getAccessToken } from '@/lib/supabase'
import { streamSearch } from '@/lib/api'
import SearchBar from '@/components/SearchBar'
import AnswerCard from '@/components/AnswerCard'
import type { SearchState } from '@/types'

const INITIAL_STATE: SearchState = {
  status: 'idle',
  statusMessage: '',
  answer: '',
  citations: [],
  evidence_grade: '',
  error: null,
}

function Dots({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2.5 text-sm text-gray-400 py-4">
      <span className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-bounce"
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
          setState((prev) => ({ ...prev, status: 'done' }))
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

  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-16">
      <div className="w-full max-w-2xl space-y-10">

        {/* Header */}
        <div className="text-center">
          <h1 className="text-3xl font-bold text-teal-700 tracking-tight">Qwiva</h1>
          <p className="text-sm text-gray-400 mt-1">
            Guideline-grounded answers for clinical practice
          </p>
        </div>

        {/* Search */}
        <SearchBar onSearch={handleSearch} isLoading={isLoading} />

        {/* Result area — same visual space throughout */}
        {state.status !== 'idle' && (
          <div className="w-full">
            {state.status === 'searching' && (
              <Dots message={state.statusMessage} />
            )}

            {(state.status === 'streaming' || state.status === 'done') && (
              <AnswerCard
                answer={state.answer}
                citations={state.citations}
                evidenceGrade={state.evidence_grade}
                isStreaming={state.status === 'streaming'}
                isDone={state.status === 'done'}
              />
            )}

            {state.status === 'error' && (
              <div className="py-4">
                <p className="text-sm text-red-500">{state.error}</p>
              </div>
            )}
          </div>
        )}

      </div>
    </main>
  )
}
