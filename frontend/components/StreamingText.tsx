'use client'

import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import type { Citation } from '@/types'

interface Props {
  text: string
  isStreaming: boolean
  citations?: Citation[]
}

export default function StreamingText({ text, isStreaming, citations }: Props) {
  const targetRef = useRef('')
  const [displayed, setDisplayed] = useState('')

  // Keep targetRef current; on stream end immediately show full text
  useEffect(() => {
    targetRef.current = text
    if (!isStreaming) {
      setDisplayed(text)
    }
  }, [text, isStreaming])

  // Smooth character drain — decouples bursty token delivery from what ReactMarkdown renders
  useEffect(() => {
    if (!isStreaming) return
    const id = setInterval(() => {
      setDisplayed(prev => {
        const target = targetRef.current
        if (prev.length >= target.length) return prev
        const queued = target.length - prev.length
        // Adaptive: stay near natural reading pace but catch up if queue builds
        const n = queued > 200 ? 18 : queued > 80 ? 7 : 3
        return target.slice(0, prev.length + n)
      })
    }, 16)
    return () => clearInterval(id)
  }, [isStreaming])

  const compressed = compressCitations(displayed)
  const normalised = normaliseCheckboxes(compressed)
  const processed = normalised.replace(/\[(\d+(?:-\d+)?)\]/g, '<cite data-n="$1">$1</cite>')

  return (
    <div className="prose prose-sm prose-invert max-w-none
      prose-p:text-[#d4d4d4] prose-p:leading-7 prose-p:my-3
      prose-headings:text-[#e8e8e8] prose-headings:font-semibold
      prose-strong:text-[#e8e8e8] prose-strong:font-semibold
      prose-ul:text-[#d4d4d4] prose-li:my-1
      prose-code:text-teal-400 prose-code:bg-teal-500/10 prose-code:rounded prose-code:px-1
      prose-a:text-teal-400 prose-a:no-underline hover:prose-a:underline">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          // @ts-expect-error — custom HTML element
          cite: ({ 'data-n': n }: { 'data-n': string }) => {
            const firstIdx = parseInt(n.split('-')[0])
            const citation = citations?.find(c => c.index === firstIdx)

            // While streaming, always show a plain circle — the ReactMarkdown tree
            // re-renders every 16ms (character drain), which destroys CSS group-hover
            // state mid-interaction. Stable interactive pills only appear once done.
            if (isStreaming || !citation) {
              return (
                <sup>
                  <span className="inline-flex items-center justify-center w-4 h-4 ml-0.5 text-[9px] font-bold text-teal-400 bg-teal-500/10 border border-teal-500/20 rounded-full cursor-default select-none">
                    {n}
                  </span>
                </sup>
              )
            }

            const label = abbreviateCitation(citation)
            const chunk = citation.source_content || citation.excerpt

            return (
              <span className="relative inline-block group align-baseline mx-0.5">
                {/* Inline pill */}
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-semibold text-teal-400 bg-teal-500/10 border border-teal-500/20 rounded cursor-default select-none hover:bg-teal-500/20 transition-colors leading-none">
                  <span className="opacity-60">{n}</span>
                  <span className="max-w-[72px] truncate">{label}</span>
                </span>

                {/* Hover tooltip — pure CSS, no JS state */}
                <span className="absolute bottom-full left-0 pb-2 z-50 invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-opacity duration-150 pointer-events-none group-hover:pointer-events-auto w-80">
                  <span className="block bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg shadow-2xl p-3 text-left">
                    <span className="block text-xs font-semibold text-[#e8e8e8] leading-snug mb-1">
                      {citation.guideline_title}
                    </span>
                    {citation.section && (
                      <span className="block text-[11px] text-[#9a9a9a] mb-1">
                        § {citation.section}
                      </span>
                    )}
                    <span className="block text-[11px] text-[#6b6b6b] mb-2">
                      {[citation.publisher, citation.year].filter(Boolean).join(' · ')}
                    </span>
                    {chunk && (
                      <>
                        <span className="block text-[10px] font-semibold text-[#4a4a4a] uppercase tracking-wider mb-1">
                          Retrieved excerpt
                        </span>
                        <span className="block text-[11px] text-[#9a9a9a] leading-relaxed max-h-36 overflow-y-auto whitespace-pre-wrap">
                          {chunk}
                        </span>
                      </>
                    )}
                  </span>
                </span>
              </span>
            )
          },
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Produce a short source label for the inline pill
// ---------------------------------------------------------------------------
function abbreviateCitation(c: Citation): string {
  const pub = c.publisher ?? ''
  // Match known acronyms standalone or in parens
  const acr = pub.match(/\b(WHO|RCOG|KDIGO|NICE|CDC|AHA|ACC|ESC|FIGO|ICM|ACOG|ACSM|NHS)\b/i)
           ?? pub.match(/\(([A-Z]{2,6})\)/)
  if (acr) return c.year ? `${acr[1].toUpperCase()} ${c.year}` : acr[1].toUpperCase()
  // First word of publisher if concise
  const word = pub.split(/[\s,;(]/)[0]
  if (word && word.length >= 2 && word.length <= 8) return c.year ? `${word} ${c.year}` : word
  // Truncated guideline title as last resort
  const t = c.guideline_title ?? ''
  return t.length > 12 ? t.slice(0, 12) + '…' : t || String(c.index)
}

// ---------------------------------------------------------------------------
// Normalise ☐ checkbox characters → Markdown list items so ReactMarkdown
// renders them as a proper list. Handles both ". ☐" mid-paragraph runs
// (the LLM collapses items onto one line) and line-initial ☐.
// ---------------------------------------------------------------------------
function normaliseCheckboxes(text: string): string {
  if (!text.includes('☐')) return text

  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (trimmed.startsWith('☐') || trimmed.includes('. ☐')) {
        const items = trimmed
          .split(/\s*\.\s*☐\s*/)
          .map((s) => s.replace(/^☐\s*/, '').replace(/\s*\.$/, '').trim())
          .filter(Boolean)
        return items.map((item) => `- ${item}`).join('\n')
      }
      return line
    })
    .join('\n')
}

// ---------------------------------------------------------------------------
// Compress adjacent citation runs: [1][2][3] → [1-3]
// ---------------------------------------------------------------------------
function compressCitations(text: string): string {
  return text.replace(/(\[\d+\])+/g, (match) => {
    const nums = [...match.matchAll(/\[(\d+)\]/g)]
      .map((m) => parseInt(m[1]))
      .sort((a, b) => a - b)

    const ranges: string[] = []
    let start = nums[0], end = nums[0]

    for (let i = 1; i < nums.length; i++) {
      if (nums[i] === end + 1) {
        end = nums[i]
      } else {
        ranges.push(start === end ? `[${start}]` : `[${start}-${end}]`)
        start = nums[i]; end = nums[i]
      }
    }
    ranges.push(start === end ? `[${start}]` : `[${start}-${end}]`)
    return ranges.join('')
  })
}
