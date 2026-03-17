'use client'

import type { Citation } from '@/types'
import StreamingText from './StreamingText'

interface Props {
  answer: string
  citations: Citation[]
  evidenceGrade: string
  isStreaming: boolean
  isDone: boolean
}

export default function AnswerCard({
  answer,
  citations,
  evidenceGrade,
  isStreaming,
  isDone,
}: Props) {
  // Citations are already deduplicated by the backend
  const uniqueCitations = citations

  return (
    <div className="w-full space-y-8">
      {/* Evidence grade pill */}
      {evidenceGrade && (
        <span className="inline-block px-2.5 py-0.5 text-xs font-medium text-teal-800 bg-teal-50 border border-teal-200 rounded-full">
          {evidenceGrade}
        </span>
      )}

      {/* Answer — typewriter reveal */}
      {isStreaming && !answer ? (
        <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-bounce"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
          <span>Generating answer…</span>
        </div>
      ) : (
        <StreamingText text={answer} isStreaming={isStreaming} />
      )}

      {/* Sources — only after streaming is complete */}
      {isDone && uniqueCitations.length > 0 && (
        <div className="pt-4 border-t border-gray-100 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Sources
            </p>
            <button
              onClick={() => console.log('Learn this topic', uniqueCitations)}
              className="text-xs font-medium text-teal-600 hover:text-teal-800 transition-colors"
            >
              Learn this topic →
            </button>
          </div>
          <ol className="space-y-3">
            {uniqueCitations.map((c) => (
              <li key={c.index} className="flex gap-3">
                <span className="flex-shrink-0 flex items-center justify-center w-4 h-4 mt-0.5 text-[9px] font-bold text-teal-700 bg-teal-50 border border-teal-200 rounded-full">
                  {c.index}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 leading-snug">
                    {c.guideline_title}
                  </p>
                  {c.section && (
                    <p className="text-xs text-gray-400 mt-0.5 truncate">{c.section}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-0.5">
                    {[c.publisher, c.year].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

