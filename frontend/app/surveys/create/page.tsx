'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, getAccessToken } from '@/lib/supabase'
import { fetchMyProfile, createSurvey, updateSurveyStatus } from '@/lib/api'
import Navbar from '@/components/Navbar'
import type { QuestionType } from '@/types'

interface OptionDraft {
  key: string
  id: string
  text: string
}

interface QuestionDraft {
  key: string
  question_text: string
  question_type: QuestionType
  options: OptionDraft[]
  scale_min: number
  scale_max: number
  scale_min_label: string
  scale_max_label: string
  is_required: boolean
  order_index: number
}

function newQuestion(index: number): QuestionDraft {
  return {
    key: crypto.randomUUID(),
    question_text: '',
    question_type: 'multiple_choice',
    options: [
      { key: crypto.randomUUID(), id: crypto.randomUUID(), text: '' },
      { key: crypto.randomUUID(), id: crypto.randomUUID(), text: '' },
    ],
    scale_min: 1,
    scale_max: 5,
    scale_min_label: '',
    scale_max_label: '',
    is_required: true,
    order_index: index,
  }
}

const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
  { value: 'multiple_choice', label: 'Multiple choice' },
  { value: 'multi_select', label: 'Multi-select' },
  { value: 'scale', label: 'Scale (1–N)' },
  { value: 'open_text', label: 'Open text' },
]

export default function CreateSurveyPage() {
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [authReady, setAuthReady] = useState(false)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [estimatedMinutes, setEstimatedMinutes] = useState('')
  const [specialtyTagsRaw, setSpecialtyTagsRaw] = useState('')
  const [isAnonymous, setIsAnonymous] = useState(false)
  const [questions, setQuestions] = useState<QuestionDraft[]>([newQuestion(0)])

  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/auth/login'); return }
      const t = await getAccessToken()
      if (!t) { router.push('/auth/login'); return }
      setToken(t)
      const profile = await fetchMyProfile(t).catch(() => null)
      if (!profile || profile.role !== 'admin') {
        router.push('/surveys')
        return
      }
      setAuthReady(true)
    })
  }, [router])

  function updateQuestion(key: string, update: Partial<QuestionDraft>) {
    setQuestions((prev) =>
      prev.map((q) => (q.key === key ? { ...q, ...update } : q))
    )
  }

  function addOption(qKey: string) {
    setQuestions((prev) =>
      prev.map((q) =>
        q.key === qKey
          ? {
              ...q,
              options: [
                ...q.options,
                { key: crypto.randomUUID(), id: crypto.randomUUID(), text: '' },
              ],
            }
          : q
      )
    )
  }

  function removeOption(qKey: string, optKey: string) {
    setQuestions((prev) =>
      prev.map((q) =>
        q.key === qKey
          ? { ...q, options: q.options.filter((o) => o.key !== optKey) }
          : q
      )
    )
  }

  function updateOption(qKey: string, optKey: string, text: string) {
    setQuestions((prev) =>
      prev.map((q) =>
        q.key === qKey
          ? {
              ...q,
              options: q.options.map((o) => (o.key === optKey ? { ...o, text } : o)),
            }
          : q
      )
    )
  }

  function addQuestion() {
    setQuestions((prev) => [...prev, newQuestion(prev.length)])
  }

  function removeQuestion(key: string) {
    setQuestions((prev) =>
      prev.filter((q) => q.key !== key).map((q, i) => ({ ...q, order_index: i }))
    )
  }

  function moveQuestion(key: string, dir: -1 | 1) {
    setQuestions((prev) => {
      const idx = prev.findIndex((q) => q.key === key)
      const next = idx + dir
      if (next < 0 || next >= prev.length) return prev
      const arr = [...prev]
      ;[arr[idx], arr[next]] = [arr[next], arr[idx]]
      return arr.map((q, i) => ({ ...q, order_index: i }))
    })
  }

  function validate(): string | null {
    if (!title.trim()) return 'Title is required'
    if (questions.length === 0) return 'Add at least one question'
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]
      if (!q.question_text.trim()) return `Question ${i + 1} needs text`
      if (q.question_type === 'multiple_choice' || q.question_type === 'multi_select') {
        if (q.options.length < 2) return `Question ${i + 1} needs at least 2 options`
        if (q.options.some((o) => !o.text.trim())) return `Question ${i + 1} has an empty option`
      }
    }
    return null
  }

  async function handleSave(publish: boolean) {
    const err = validate()
    if (err) { setFormError(err); return }
    if (!token) return
    setFormError(null)
    setSaving(true)

    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      estimated_minutes: estimatedMinutes ? parseInt(estimatedMinutes, 10) : null,
      specialty_tags: specialtyTagsRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      is_anonymous: isAnonymous,
      status: 'draft' as const,
      questions: questions.map((q, i) => ({
        question_text: q.question_text,
        question_type: q.question_type,
        options:
          q.question_type === 'multiple_choice' || q.question_type === 'multi_select'
            ? q.options.map((o) => ({ id: o.id, text: o.text }))
            : null,
        scale_min: q.scale_min,
        scale_max: q.scale_max,
        scale_min_label: q.scale_min_label || null,
        scale_max_label: q.scale_max_label || null,
        is_required: q.is_required,
        order_index: i,
      })),
    }

    try {
      const survey = await createSurvey(payload, token)
      if (publish) {
        await updateSurveyStatus(survey.id, 'active', token)
        router.push(`/surveys/${survey.id}`)
      } else {
        router.push('/surveys')
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save survey')
    } finally {
      setSaving(false)
    }
  }

  if (!authReady) {
    return (
      <div className="min-h-screen bg-brand-bg">
        <Navbar />
        <div className="max-w-2xl mx-auto px-4 pt-20 pb-24 animate-pulse space-y-4">
          <div className="h-7 bg-brand-raised rounded w-1/3" />
          <div className="h-32 bg-brand-surface border border-brand-border rounded-2xl" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-brand-bg">
      <Navbar />
      <div className="max-w-2xl mx-auto px-4 pt-20 pb-32">
        <h1 className="text-xl font-bold text-brand-text mb-6">Create Survey</h1>

        <div className="space-y-5">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-brand-text mb-1">
              Title <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Survey title…"
              className="w-full px-4 py-2.5 bg-brand-surface border border-brand-border rounded-xl text-sm text-brand-text placeholder-brand-subtle outline-none focus:border-brand-accent/45 transition-all"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-brand-text mb-1">Description</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description…"
              className="w-full px-4 py-2.5 bg-brand-surface border border-brand-border rounded-xl text-sm text-brand-text placeholder-brand-subtle outline-none focus:border-brand-accent/45 resize-none transition-all"
            />
          </div>

          {/* Settings row */}
          <div className="flex gap-3 flex-wrap">
            <div className="flex-1 min-w-[140px]">
              <label className="block text-sm font-medium text-brand-text mb-1">
                Estimated minutes
              </label>
              <input
                type="number"
                min={1}
                value={estimatedMinutes}
                onChange={(e) => setEstimatedMinutes(e.target.value)}
                placeholder="e.g. 5"
                className="w-full px-4 py-2.5 bg-brand-surface border border-brand-border rounded-xl text-sm text-brand-text placeholder-brand-subtle outline-none focus:border-brand-accent/45 transition-all"
              />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="block text-sm font-medium text-brand-text mb-1">
                Specialty tags (comma-separated)
              </label>
              <input
                type="text"
                value={specialtyTagsRaw}
                onChange={(e) => setSpecialtyTagsRaw(e.target.value)}
                placeholder="e.g. Cardiology, General"
                className="w-full px-4 py-2.5 bg-brand-surface border border-brand-border rounded-xl text-sm text-brand-text placeholder-brand-subtle outline-none focus:border-brand-accent/45 transition-all"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isAnonymous}
              onChange={(e) => setIsAnonymous(e.target.checked)}
              className="accent-brand-accent"
            />
            <span className="text-sm text-brand-text">Anonymous responses</span>
          </label>

          {/* Questions */}
          <div className="space-y-4 pt-2">
            <h2 className="text-base font-semibold text-brand-text">Questions</h2>
            {questions.map((q, idx) => (
              <div
                key={q.key}
                className="bg-brand-surface border border-brand-border rounded-2xl p-5 space-y-4"
              >
                <div className="flex items-start gap-3">
                  <span className="text-sm font-medium text-brand-muted pt-2.5 shrink-0 w-5">
                    {idx + 1}.
                  </span>
                  <div className="flex-1 space-y-3">
                    <input
                      type="text"
                      value={q.question_text}
                      onChange={(e) => updateQuestion(q.key, { question_text: e.target.value })}
                      placeholder="Question text…"
                      className="w-full px-4 py-2.5 bg-brand-raised border border-brand-border rounded-xl text-sm text-brand-text placeholder-brand-subtle outline-none focus:border-brand-accent/45 transition-all"
                    />
                    <div className="flex items-center gap-3 flex-wrap">
                      <select
                        value={q.question_type}
                        onChange={(e) =>
                          updateQuestion(q.key, { question_type: e.target.value as QuestionType })
                        }
                        className="px-3 py-2 bg-brand-raised border border-brand-border rounded-lg text-sm text-brand-text outline-none focus:border-brand-accent/45 transition-all"
                      >
                        {QUESTION_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                      <label className="flex items-center gap-1.5 cursor-pointer text-sm text-brand-muted">
                        <input
                          type="checkbox"
                          checked={q.is_required}
                          onChange={(e) => updateQuestion(q.key, { is_required: e.target.checked })}
                          className="accent-brand-accent"
                        />
                        Required
                      </label>
                    </div>

                    {/* Options for MC/multi-select */}
                    {(q.question_type === 'multiple_choice' || q.question_type === 'multi_select') && (
                      <div className="space-y-2">
                        {q.options.map((opt) => (
                          <div key={opt.key} className="flex items-center gap-2">
                            <input
                              type="text"
                              value={opt.text}
                              onChange={(e) => updateOption(q.key, opt.key, e.target.value)}
                              placeholder="Option text…"
                              className="flex-1 px-3 py-2 bg-brand-raised border border-brand-border rounded-lg text-sm text-brand-text placeholder-brand-subtle outline-none focus:border-brand-accent/45 transition-all"
                            />
                            {q.options.length > 2 && (
                              <button
                                type="button"
                                onClick={() => removeOption(q.key, opt.key)}
                                className="text-brand-subtle hover:text-red-400 transition-colors text-lg leading-none"
                              >
                                ×
                              </button>
                            )}
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => addOption(q.key)}
                          className="text-xs text-brand-accent hover:opacity-80 transition-opacity"
                        >
                          + Add option
                        </button>
                      </div>
                    )}

                    {/* Scale settings */}
                    {q.question_type === 'scale' && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <div>
                            <label className="block text-xs text-brand-muted mb-1">Min</label>
                            <input
                              type="number"
                              min={1}
                              value={q.scale_min}
                              onChange={(e) =>
                                updateQuestion(q.key, { scale_min: parseInt(e.target.value, 10) || 1 })
                              }
                              className="w-16 px-2 py-1.5 bg-brand-raised border border-brand-border rounded-lg text-sm text-brand-text outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-brand-muted mb-1">Max</label>
                            <input
                              type="number"
                              min={2}
                              value={q.scale_max}
                              onChange={(e) =>
                                updateQuestion(q.key, { scale_max: parseInt(e.target.value, 10) || 5 })
                              }
                              className="w-16 px-2 py-1.5 bg-brand-raised border border-brand-border rounded-lg text-sm text-brand-text outline-none"
                            />
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <input
                            type="text"
                            value={q.scale_min_label}
                            onChange={(e) => updateQuestion(q.key, { scale_min_label: e.target.value })}
                            placeholder={`Label for ${q.scale_min}`}
                            className="flex-1 px-3 py-2 bg-brand-raised border border-brand-border rounded-lg text-sm text-brand-text placeholder-brand-subtle outline-none focus:border-brand-accent/45 transition-all"
                          />
                          <input
                            type="text"
                            value={q.scale_max_label}
                            onChange={(e) => updateQuestion(q.key, { scale_max_label: e.target.value })}
                            placeholder={`Label for ${q.scale_max}`}
                            className="flex-1 px-3 py-2 bg-brand-raised border border-brand-border rounded-lg text-sm text-brand-text placeholder-brand-subtle outline-none focus:border-brand-accent/45 transition-all"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Question controls */}
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => moveQuestion(q.key, -1)}
                      disabled={idx === 0}
                      className="p-1 text-brand-subtle hover:text-brand-text disabled:opacity-30 transition-colors"
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveQuestion(q.key, 1)}
                      disabled={idx === questions.length - 1}
                      className="p-1 text-brand-subtle hover:text-brand-text disabled:opacity-30 transition-colors"
                      title="Move down"
                    >
                      ↓
                    </button>
                    {questions.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeQuestion(q.key)}
                        className="p-1 text-brand-subtle hover:text-red-400 transition-colors"
                        title="Remove question"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={addQuestion}
              className="w-full py-3 border border-dashed border-brand-border rounded-2xl text-sm text-brand-muted hover:text-brand-text hover:border-brand-accent/40 transition-all"
            >
              + Add question
            </button>
          </div>

          {formError && (
            <p className="text-sm text-red-500">{formError}</p>
          )}

          {/* Actions */}
          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={() => router.push('/surveys')}
              className="text-sm px-5 py-2.5 rounded-xl bg-brand-raised text-brand-muted hover:text-brand-text transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => handleSave(false)}
              className="text-sm px-5 py-2.5 rounded-xl border border-brand-border text-brand-text hover:bg-brand-raised disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : 'Save Draft'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => handleSave(true)}
              className="text-sm px-6 py-2.5 rounded-xl bg-brand-accent text-white font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {saving ? 'Publishing…' : 'Publish'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
