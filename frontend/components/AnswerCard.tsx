'use client'

import type { Citation } from '@/types'
import StreamingText from './StreamingText'

interface Props {
  answer: string
  citations: Citation[]
  isStreaming: boolean
  isDone: boolean
}

export default function AnswerCard({ answer, citations, isStreaming, isDone }: Props) {
  const uniqueCitations = citations  // deduplicated by backend

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

      {/* Sources — only after done */}
      {isDone && uniqueCitations.length > 0 && (
        <div className="pt-5 border-t border-[#2a2a2a] space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-[#6b6b6b] uppercase tracking-widest">
              Sources
            </p>
            <button
              onClick={() => console.log('Learn topic', uniqueCitations)}
              className="text-xs text-teal-500 hover:text-teal-400 transition-colors"
            >
              Learn this topic →
            </button>
          </div>

          <ol className="space-y-4">
            {uniqueCitations.map((c) => (
              <li key={c.index} className="flex gap-3">
                <span className="flex-shrink-0 flex items-center justify-center w-5 h-5 mt-0.5 text-[10px] font-bold text-teal-400 bg-teal-500/10 border border-teal-500/20 rounded-full">
                  {c.index}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[#e8e8e8] leading-snug">
                    {c.guideline_title}
                  </p>
                  {c.section && (
                    <p className="text-xs text-[#6b6b6b] mt-0.5 truncate">{c.section}</p>
                  )}
                  <p className="text-xs text-[#4a4a4a] mt-0.5">
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
