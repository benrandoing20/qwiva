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
}

export default function AnswerCard({ answer, citations, isStreaming, isDone, statusMessage, suggestions, onSuggest }: Props) {
  const [showAll, setShowAll] = useState(false)

  const visible = showAll ? citations : citations.slice(0, MAX_VISIBLE)
  const hiddenCount = citations.length - MAX_VISIBLE

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
        style={{ opacity: isDone && citations.length > 0 ? 1 : 0, pointerEvents: isDone && citations.length > 0 ? 'auto' : 'none' }}
      >
        {citations.length > 0 && (
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
                        className="text-xs text-brand-text/85 leading-snug hover:text-brand-accent-hover transition-colors"
                      >
                        {c.guideline_title}
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

      {/* Follow-up suggestions — fade in after done */}
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
    </div>
  )
}
