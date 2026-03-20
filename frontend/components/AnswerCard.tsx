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
}

export default function AnswerCard({ answer, citations, isStreaming, isDone }: Props) {
  const [showAll, setShowAll] = useState(false)

  const visible = showAll ? citations : citations.slice(0, MAX_VISIBLE)
  const hiddenCount = citations.length - MAX_VISIBLE

  return (
    <div className="w-full space-y-6">
      {/* Answer */}
      {isStreaming && !answer ? (
        <div className="flex items-center gap-2.5 text-sm text-[#6b6b6b] py-2">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 bg-teal-500 rounded-full animate-bounce"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
          <span>Generating answer…</span>
        </div>
      ) : (
        <StreamingText text={answer} isStreaming={isStreaming} />
      )}

      {/* Sources — only after done, only when there are citations */}
      {isDone && citations.length > 0 && (
        <div className="pt-4 border-t border-[#2a2a2a]">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-[#6b6b6b] uppercase tracking-widest">
              Sources
            </p>
            <Link
              href="/learn"
              className="text-xs text-teal-500 hover:text-teal-400 transition-colors"
            >
              Learn this topic →
            </Link>
          </div>

          <ol className="space-y-2.5">
            {visible.map((c) => (
              <li key={c.index} className="flex gap-2.5 items-start">
                <span className="flex-shrink-0 flex items-center justify-center w-5 h-5 mt-0.5 text-[9px] font-bold text-teal-400 bg-teal-500/10 border border-teal-500/20 rounded-full">
                  {c.index}
                </span>
                <div className="min-w-0">
                  <p className="text-xs text-[#c8c8c8] leading-snug">{c.guideline_title}</p>
                  <p className="text-[11px] text-[#4a4a4a] mt-0.5">
                    {[c.publisher, c.year].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          {hiddenCount > 0 && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="mt-2.5 text-xs text-[#6b6b6b] hover:text-teal-400 transition-colors"
            >
              {showAll ? 'Show less' : `+${hiddenCount} more source${hiddenCount > 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
