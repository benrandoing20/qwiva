'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase, getAccessToken } from '@/lib/supabase'
import { fetchSurvey, submitSurveyResponse } from '@/lib/api'
import Navbar from '@/components/Navbar'
import type { Survey, SurveyQuestion, SurveyAnswerInput } from '@/types'

function ScaleQuestion({
  question,
  value,
  onChange,
  error,
}: {
  question: SurveyQuestion
  value: string | undefined
  onChange: (v: string) => void
  error?: boolean
}) {
  const min = question.scale_min ?? 1
  const max = question.scale_max ?? 5
  const steps = Array.from({ length: max - min + 1 }, (_, i) => min + i)

  return (
    <div>
      <div className="flex gap-2 mt-2">
        {steps.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(String(n))}
            className={`w-10 h-10 rounded-xl text-sm font-medium transition-all border ${
              value === String(n)
                ? 'bg-brand-accent text-white border-brand-accent'
                : 'bg-brand-raised text-brand-text border-brand-border hover:border-brand-accent/50'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      {(question.scale_min_label || question.scale_max_label) && (
        <div className="flex justify-between mt-1 text-xs text-brand-subtle">
          <span>{question.scale_min_label ?? ''}</span>
          <span>{question.scale_max_label ?? ''}</span>
        </div>
      )}
      {error && <p className="text-xs text-red-500 mt-1">This question is required</p>}
    </div>
  )
}

export default function TakeSurveyPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [survey, setSurvey] = useState<Survey | null>(null)
  const [loading, setLoading] = useState(true)
  const [answers, setAnswers] = useState<Record<string, SurveyAnswerInput>>({})
  const [errors, setErrors] = useState<Record<string, boolean>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [alreadyResponded, setAlreadyResponded] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/auth/login'); return }
      const t = await getAccessToken()
      if (!t) { router.push('/auth/login'); return }
      setToken(t)
    })
  }, [router])

  useEffect(() => {
    if (!token || !id) return
    fetchSurvey(id, token)
      .then((s) => {
        setSurvey(s)
        if (s.has_responded) setAlreadyResponded(true)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [token, id])

  function setAnswer(questionId: string, update: Partial<SurveyAnswerInput>) {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: { ...prev[questionId], question_id: questionId, ...update },
    }))
    setErrors((prev) => ({ ...prev, [questionId]: false }))
  }

  function validate(): boolean {
    if (!survey?.questions) return true
    const newErrors: Record<string, boolean> = {}
    let valid = true
    for (const q of survey.questions) {
      if (!q.is_required) continue
      const a = answers[q.id]
      const hasText = a?.answer_text && a.answer_text.trim().length > 0
      const hasOptions = a?.answer_options && a.answer_options.length > 0
      if (q.question_type === 'open_text' && !hasText) {
        newErrors[q.id] = true
        valid = false
      } else if (q.question_type === 'scale' && !hasText) {
        newErrors[q.id] = true
        valid = false
      } else if ((q.question_type === 'multiple_choice' || q.question_type === 'multi_select') && !hasOptions) {
        newErrors[q.id] = true
        valid = false
      }
    }
    setErrors(newErrors)
    return valid
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate() || !token || !id) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      await submitSurveyResponse(id, Object.values(answers), token)
      setSubmitted(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('422') || msg.toLowerCase().includes('already responded')) {
        setAlreadyResponded(true)
      } else {
        setSubmitError('Something went wrong. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-bg">
        <Navbar />
        <div className="max-w-2xl mx-auto px-4 pt-20 pb-24 animate-pulse space-y-4">
          <div className="h-7 bg-brand-raised rounded w-2/3" />
          <div className="h-4 bg-brand-raised rounded w-full" />
          <div className="h-32 bg-brand-surface border border-brand-border rounded-2xl" />
        </div>
      </div>
    )
  }

  if (!survey) {
    return (
      <div className="min-h-screen bg-brand-bg">
        <Navbar />
        <div className="max-w-2xl mx-auto px-4 pt-20 pb-24 text-center text-brand-muted">
          Survey not found.
        </div>
      </div>
    )
  }

  if (alreadyResponded) {
    return (
      <div className="min-h-screen bg-brand-bg">
        <Navbar />
        <div className="max-w-2xl mx-auto px-4 pt-20 pb-24 text-center">
          <div className="bg-brand-surface border border-brand-border rounded-2xl p-10 mt-8">
            <div className="text-4xl mb-4">✓</div>
            <h2 className="text-lg font-semibold text-brand-text mb-2">Already submitted</h2>
            <p className="text-sm text-brand-muted mb-6">You have already responded to this survey.</p>
            <button
              onClick={() => router.push('/surveys')}
              className="text-sm px-5 py-2.5 rounded-xl bg-brand-raised text-brand-text hover:bg-brand-border transition-colors"
            >
              Back to Surveys
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-brand-bg">
        <Navbar />
        <div className="max-w-2xl mx-auto px-4 pt-20 pb-24 text-center">
          <div className="bg-brand-surface border border-brand-border rounded-2xl p-10 mt-8">
            <div className="text-4xl mb-4">🎉</div>
            <h2 className="text-lg font-semibold text-brand-text mb-2">Thank you!</h2>
            <p className="text-sm text-brand-muted mb-6">
              Your response to &quot;{survey.title}&quot; has been recorded.
            </p>
            <button
              onClick={() => router.push('/surveys')}
              className="text-sm px-5 py-2.5 rounded-xl bg-brand-raised text-brand-text hover:bg-brand-border transition-colors"
            >
              Back to Surveys
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-brand-bg">
      <Navbar />
      <div className="max-w-2xl mx-auto px-4 pt-20 pb-24">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-brand-text mb-1">{survey.title}</h1>
          {survey.description && (
            <p className="text-sm text-brand-muted">{survey.description}</p>
          )}
          {survey.estimated_minutes && (
            <p className="text-xs text-brand-subtle mt-1">Est. {survey.estimated_minutes} minutes</p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {(survey.questions ?? []).map((q, i) => (
            <div
              key={q.id}
              className="bg-brand-surface border border-brand-border rounded-2xl p-5"
            >
              <p className="text-sm font-medium text-brand-text mb-1">
                {i + 1}. {q.question_text}
                {q.is_required && <span className="text-red-400 ml-1">*</span>}
              </p>

              {q.question_type === 'multiple_choice' && (
                <div className="space-y-2 mt-3">
                  {(q.options ?? []).map((opt) => (
                    <label
                      key={opt.id}
                      className="flex items-center gap-3 cursor-pointer group"
                    >
                      <input
                        type="radio"
                        name={`q-${q.id}`}
                        value={opt.id}
                        checked={answers[q.id]?.answer_options?.[0] === opt.id}
                        onChange={() => setAnswer(q.id, { answer_options: [opt.id] })}
                        className="accent-brand-accent"
                      />
                      <span className="text-sm text-brand-text group-hover:text-brand-accent transition-colors">
                        {opt.text}
                      </span>
                    </label>
                  ))}
                  {errors[q.id] && (
                    <p className="text-xs text-red-500 mt-1">This question is required</p>
                  )}
                </div>
              )}

              {q.question_type === 'multi_select' && (
                <div className="space-y-2 mt-3">
                  {(q.options ?? []).map((opt) => {
                    const selected = answers[q.id]?.answer_options ?? []
                    const checked = selected.includes(opt.id)
                    return (
                      <label key={opt.id} className="flex items-center gap-3 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const next = checked
                              ? selected.filter((x) => x !== opt.id)
                              : [...selected, opt.id]
                            setAnswer(q.id, { answer_options: next })
                          }}
                          className="accent-brand-accent"
                        />
                        <span className="text-sm text-brand-text group-hover:text-brand-accent transition-colors">
                          {opt.text}
                        </span>
                      </label>
                    )
                  })}
                  {errors[q.id] && (
                    <p className="text-xs text-red-500 mt-1">This question is required</p>
                  )}
                </div>
              )}

              {q.question_type === 'scale' && (
                <ScaleQuestion
                  question={q}
                  value={answers[q.id]?.answer_text ?? undefined}
                  onChange={(v) => setAnswer(q.id, { answer_text: v })}
                  error={errors[q.id]}
                />
              )}

              {q.question_type === 'open_text' && (
                <div className="mt-3">
                  <textarea
                    rows={3}
                    value={answers[q.id]?.answer_text ?? ''}
                    onChange={(e) => setAnswer(q.id, { answer_text: e.target.value })}
                    placeholder="Your response…"
                    className="w-full px-4 py-3 bg-brand-raised border border-brand-border rounded-xl text-sm text-brand-text placeholder-brand-subtle outline-none focus:border-brand-accent/45 resize-none transition-all"
                  />
                  {errors[q.id] && (
                    <p className="text-xs text-red-500 mt-1">This question is required</p>
                  )}
                </div>
              )}
            </div>
          ))}

          {submitError && (
            <p className="text-sm text-red-500 text-center">{submitError}</p>
          )}

          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={() => router.push('/surveys')}
              className="text-sm px-5 py-2.5 rounded-xl bg-brand-raised text-brand-muted hover:text-brand-text transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="text-sm px-6 py-2.5 rounded-xl bg-brand-accent text-white font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
