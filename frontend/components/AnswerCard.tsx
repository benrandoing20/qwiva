'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Citation } from '@/types'
import StreamingText from './StreamingText'

const MAX_VISIBLE = 3

interface Props {
  answer: string
  citations: Citation[]
  isStreaming: boolean
  isDone: boolean
  statusMessage?: string
  suggestions?: string[]
  onSuggest?: (q: string) => void
  onRate?: (rating: 'up' | 'down', comment?: string) => void
}

export default function AnswerCard({ answer, citations, isStreaming, isDone, statusMessage, suggestions, onSuggest, onRate }: Props) {
  const [showAll, setShowAll] = useState(false)
  const [rating, setRating] = useState<'up' | 'down' | null>(null)
  const [showComment, setShowComment] = useState(false)
  const [comment, setComment] = useState('')

  function handleThumb(thumb: 'up' | 'down') {
    const newRating = rating === thumb ? null : thumb
    setRating(newRating)
    setShowComment(newRating === 'down')
    if (newRating !== 'down') {
      setComment('')
      if (newRating) onRate?.(newRating)
    }
  }

  function submitComment() {
    onRate?.('down', comment.trim() || undefined)
    setShowComment(false)
  }

  // Deduplicate by title — backend dedup can miss when the same doc is retrieved
  // as two differently-indexed chunks that both appear in the answer.
  const uniqueCitations = citations.filter(
    (c, i, arr) => arr.findIndex(x => x.guideline_title === c.guideline_title) === i
  )
  const visible = showAll ? uniqueCitations : uniqueCitations.slice(0, MAX_VISIBLE)
  const hiddenCount = uniqueCitations.length - MAX_VISIBLE

  return (
    <div className="w-full space-y-6">
      {/* Thinking dots — visible only before first token arrives */}
      {isStreaming && !answer && (
        <div className="flex items-center gap-2.5 text-sm text-brand-muted py-2">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 bg-brand-accent rounded-full animate-bounce"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
          <span>{statusMessage ?? 'Thinking…'}</span>
        </div>
      )}
      {/* Always rendered so no DOM swap occurs when the first token arrives */}
      <StreamingText text={answer} isStreaming={isStreaming} citations={citations} />

      {/* Sources — fade in when done */}
      <div
        className="transition-opacity duration-500"
        style={{ opacity: isDone && uniqueCitations.length > 0 ? 1 : 0, pointerEvents: isDone && uniqueCitations.length > 0 ? 'auto' : 'none' }}
      >
        {uniqueCitations.length > 0 && (
          <div className="pt-4 border-t border-brand-border">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-brand-muted uppercase tracking-widest">
                References
              </p>
              <Link
                href="/learn"
                className="text-xs text-brand-accent hover:text-brand-accent-hover transition-colors"
              >
                Learn this topic →
              </Link>
            </div>

            <ol className="space-y-2.5">
              {visible.map((c) => (
                <li key={c.index} className="flex gap-2.5 items-start">
                  <span className="flex-shrink-0 flex items-center justify-center w-5 h-5 mt-0.5 text-[9px] font-bold text-brand-accent-hover bg-brand-accent/15 border border-brand-accent/25 rounded-full">
                    {c.index}
                  </span>
                  <div className="min-w-0">
                    {c.source_url ? (
                      <a
                        href={c.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-brand-accent hover:text-brand-accent-hover underline underline-offset-2 decoration-brand-accent/40 transition-colors inline-flex items-baseline gap-1 leading-snug"
                      >
                        {c.guideline_title}
                        <span className="text-[10px] no-underline flex-shrink-0">↗</span>
                      </a>
                    ) : (
                      <p className="text-xs text-brand-text/85 leading-snug">{c.guideline_title}</p>
                    )}
                    <p className="text-[11px] text-brand-subtle mt-0.5">
                      {[c.publisher, c.year].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </li>
              ))}
            </ol>

            {hiddenCount > 0 && (
              <button
                onClick={() => setShowAll((v) => !v)}
                className="mt-2.5 text-xs text-brand-muted hover:text-brand-accent-hover transition-colors"
              >
                {showAll ? 'Show less' : `+${hiddenCount} more source${hiddenCount > 1 ? 's' : ''}`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* DISABLED: Follow-up suggestions — uncomment to re-enable
      <div
        className="transition-opacity duration-500 delay-200"
        style={{ opacity: isDone && suggestions && suggestions.length > 0 ? 1 : 0, pointerEvents: isDone && suggestions && suggestions.length > 0 ? 'auto' : 'none' }}
      >
        {suggestions && suggestions.length > 0 && onSuggest && (
          <div className="pt-2">
            <p className="text-[10px] font-semibold text-brand-subtle uppercase tracking-widest mb-2.5">
              Follow up
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => onSuggest(s)}
                  className="px-3 py-1.5 text-xs text-brand-muted bg-brand-surface border border-brand-border rounded-full hover:border-brand-accent/35 hover:text-brand-accent-hover transition-all text-left"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      */}

      {/* Rating — fade in after streaming done */}
      <div
        className="transition-opacity duration-500 delay-300"
        style={{ opacity: isDone && answer ? 1 : 0, pointerEvents: isDone && answer ? 'auto' : 'none' }}
      >
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-brand-subtle mr-0.5">Was this helpful?</span>
            <button
              onClick={() => handleThumb('up')}
              aria-label="Thumbs up"
              className={`p-1.5 rounded-lg transition-colors ${
                rating === 'up'
                  ? 'text-brand-accent bg-brand-accent/15'
                  : 'text-brand-subtle hover:text-brand-text hover:bg-brand-raised'
              }`}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>
              </svg>
            </button>
            <button
              onClick={() => handleThumb('down')}
              aria-label="Thumbs down"
              className={`p-1.5 rounded-lg transition-colors ${
                rating === 'down'
                  ? 'text-brand-pink bg-brand-pink/15'
                  : 'text-brand-subtle hover:text-brand-text hover:bg-brand-raised'
              }`}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/>
              </svg>
            </button>
          </div>

          {showComment && (
            <div className="flex flex-col gap-2 animate-fadeIn">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Wrong citation? Too brief? Let us know (optional)"
                rows={2}
                className="w-full bg-brand-raised border border-brand-border rounded-xl px-3 py-2 text-xs text-brand-text placeholder-brand-subtle resize-none outline-none focus:border-brand-accent/45 focus:ring-1 focus:ring-brand-accent/15 transition-colors"
              />
              <button
                onClick={submitComment}
                className="self-end text-[11px] px-3 py-1.5 rounded-lg bg-brand-accent hover:bg-brand-accent-hover text-white font-medium transition-colors"
              >
                Submit feedback
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
