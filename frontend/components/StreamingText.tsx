'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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

  // Memoised so the `cite` function reference stays stable across the 16ms
  // setDisplayed renders. Without this, React unmounts/remounts cite nodes
  // on every tick, resetting tooltip opacity and blocking hover during streaming.
  const mdComponents = useMemo(() => ({
    table: ({ children }: { children: React.ReactNode }) => (
      <div className="overflow-x-auto my-4">
        <table className="min-w-full">{children}</table>
      </div>
    ),
    // @ts-expect-error — custom HTML element
    cite: ({ 'data-n': n }: { 'data-n': string }) => {
      const firstIdx = parseInt(n.split('-')[0])
      const citation = citations?.find(c => c.index === firstIdx)

      if (!citation) {
        return (
          <sup>
            <span className="inline-flex items-center justify-center w-4 h-4 ml-0.5 text-[9px] font-bold text-brand-accent-hover bg-brand-accent/12 border border-brand-accent/25 rounded-full cursor-default select-none">
              {n}
            </span>
          </sup>
        )
      }

      const label = abbreviateCitation(citation)
      const chunk = citation.source_content || citation.excerpt

      return (
        <span
          className="relative inline-block align-baseline mx-0.5"
          onMouseEnter={(e) => {
            // Hide any other open tooltips in this answer block first
            const wrapper = (e.currentTarget as HTMLElement).closest('.prose-stream-wrapper')
            wrapper?.querySelectorAll<HTMLElement>('.cite-tooltip').forEach(el => {
              el.style.opacity = '0'
              el.style.pointerEvents = 'none'
            })
            // Show this tooltip via direct DOM — no React state change means no
            // re-render, so cite nodes aren't remounted and hover persists cleanly.
            const tooltip = (e.currentTarget as HTMLElement).querySelector<HTMLElement>('.cite-tooltip')
            if (tooltip) {
              tooltip.style.opacity = '1'
              tooltip.style.pointerEvents = 'auto'
            }
          }}
          onMouseLeave={(e) => {
            const tooltip = (e.currentTarget as HTMLElement).querySelector<HTMLElement>('.cite-tooltip')
            if (tooltip) {
              tooltip.style.opacity = '0'
              tooltip.style.pointerEvents = 'none'
            }
          }}
        >
          {/* Inline pill */}
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-semibold text-brand-accent-hover bg-brand-accent/12 border border-brand-accent/25 rounded cursor-default select-none hover:bg-brand-accent/22 transition-colors leading-none">
            <span className="opacity-60">{n}</span>
            <span className="max-w-[120px] truncate">{label}</span>
          </span>

          {/* Tooltip — opacity toggled via direct DOM, not React state */}
          <span
            className="cite-tooltip absolute top-full left-0 pt-2 z-50 w-80"
            style={{ opacity: 0, pointerEvents: 'none', transition: 'opacity 150ms' }}
          >
            <span className="block bg-brand-surface border border-brand-border rounded-lg shadow-2xl p-3 text-left">
              <span className="block text-xs font-semibold text-brand-text leading-snug mb-1">
                {citation.guideline_title}
              </span>
              {citation.section && (
                <span className="block text-[11px] text-brand-muted mb-1">
                  Section: {citation.section}
                </span>
              )}
              <span className="block text-[11px] text-brand-subtle mb-2">
                {[citation.publisher, citation.year].filter(Boolean).join(' · ')}
              </span>
              {chunk && (
                <>
                  <span className="block text-[10px] font-semibold text-brand-subtle uppercase tracking-wider mb-1">
                    Retrieved excerpt
                  </span>
                  <span className="block text-[11px] text-brand-muted leading-relaxed max-h-36 overflow-y-auto whitespace-pre-wrap">
                    {chunk
                      .replace(/\bchunks\b/g, 'references')
                      .replace(/\bChunks\b/g, 'References')
                      .replace(/\bchunk\b/g, 'reference')
                      .replace(/\bChunk\b/g, 'Reference')
                    }
                  </span>
                </>
              )}
              {citation.source_url && (
                <a
                  href={citation.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-[10px] text-brand-accent hover:text-brand-accent-hover transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  View source ↗
                </a>
              )}
            </span>
          </span>
        </span>
      )
    },
  }), [citations])

  const compressed = compressCitations(displayed)
  const normalised = normaliseCheckboxes(compressed)
  const processed = normalised.replace(/\[(\d+(?:-\d+)?)\]/g, '<cite data-n="$1">$1</cite>')

  return (
    <div
      className="prose-stream-wrapper prose prose-sm max-w-none dark:prose-invert
        prose-p:text-brand-text/90 prose-p:leading-7 prose-p:my-3
        prose-headings:text-brand-text prose-headings:font-semibold
        prose-strong:text-brand-text prose-strong:font-semibold
        prose-ul:text-brand-text/90 prose-li:my-1
        prose-code:text-brand-accent-hover prose-code:bg-brand-accent/12 prose-code:rounded prose-code:px-1
        prose-a:text-brand-accent-hover prose-a:no-underline hover:prose-a:underline"
      data-has-content={displayed.length > 0 ? '' : undefined}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={mdComponents}
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
  const acr = pub.match(/\b(WHO|RCOG|KDIGO|NICE|CDC|AHA|ACC|ESC|FIGO|ICM|ACOG|ACSM|NHS)\b/i)
           ?? pub.match(/\(([A-Z]{2,6})\)/)
  if (acr) return c.year ? `${acr[1].toUpperCase()} ${c.year}` : acr[1].toUpperCase()
  const word = pub.split(/[\s,;(]/)[0]
  if (word && word.length >= 2 && word.length <= 8) return c.year ? `${word} ${c.year}` : word
  const t = c.guideline_title ?? ''
  return t.length > 12 ? t.slice(0, 12) + '…' : t || String(c.index)
}

// ---------------------------------------------------------------------------
// Normalise ☐ checkbox characters → Markdown list items
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
