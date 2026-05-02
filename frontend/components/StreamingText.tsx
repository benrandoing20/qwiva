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

// Continuous unveil tuning. Mirrors the mobile renderer.
const REVEAL_MIN_VELOCITY = 120 // px/sec
const REVEAL_MAX_VELOCITY = 900 // px/sec
const REVEAL_VELOCITY_GAIN = 3.2 // velocity = clamp(buffer × gain)
const REVEAL_MIN_LAG_PX = 22 // smallest gap we ever leave under the curtain
const REVEAL_THRESHOLD_PX = 40 // wait until at least this much content arrives
const GRADIENT_FADE_PX = 32

export default function StreamingText({ text, isStreaming, citations }: Props) {
  // The renderer no longer drains tokens character-by-character — the full
  // (marker-trimmed) buffer is rendered immediately and a gradient mask
  // continuously slides downward to unveil it. `displayed` is just the live
  // text so existing memoised pieces (citation handlers, regexes) keep
  // working without restructuring.
  const displayed = text

  // Memoised so the `cite` function reference stays stable across the 16ms
  // setDisplayed renders. Without this, React unmounts/remounts cite nodes
  // on every tick, resetting tooltip opacity and blocking hover during streaming.
  const mdComponents = useMemo(() => ({
    table: ({ children }: { children: React.ReactNode }) => (
      <div className="overflow-x-auto my-4">
        <table className="min-w-full">{children}</table>
      </div>
    ),
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
  // While streaming, hide unclosed markdown markers so the user never sees a
  // stray `**` flash before its closer arrives.
  const safe = isStreaming ? trimUnclosedMarkers(compressed) : compressed
  const normalised = normaliseCheckboxes(safe)
  const processed = normalised.replace(/\[(\d+(?:-\d+)?)\]/g, '<cite data-n="$1">$1</cite>')

  // ---- Continuous unveil mask -------------------------------------------
  // We render the full buffered text immediately, then drag a gradient
  // curtain downward at a constant pixel-per-second velocity. The curtain
  // top trails the bottom of the content by REVEAL_BUFFER_LAG_PX so it
  // never "catches up" mid-stream — the unveil stays continuous regardless
  // of how bursty the SSE tokens arrive.
  const contentRef = useRef<HTMLDivElement>(null)
  const [contentH, setContentH] = useState(0)
  const [revealY, setRevealY] = useState(0)
  const revealAnimRef = useRef<{ from: number; to: number; start: number; duration: number } | null>(null)
  const rafRef = useRef<number | null>(null)

  // Observe content height changes (text growth as tokens arrive).
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const h = entries[0]?.contentRect.height ?? 0
      setContentH(h)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Schedule reveal animation whenever content grows or streaming flips.
  // Velocity is adaptive: scales with how many pixels of content are currently
  // hidden under the mask. Buffer big → fast catch-up. Buffer small → slow.
  useEffect(() => {
    if (contentH <= 0) return
    if (isStreaming && contentH < REVEAL_THRESHOLD_PX) return

    const baseTarget = isStreaming
      ? Math.max(0, contentH - REVEAL_MIN_LAG_PX)
      : contentH
    const target = Math.max(revealY, baseTarget)
    if (target <= revealY) return
    const distance = target - revealY

    const buffer = Math.max(0, contentH - revealY)
    const velocity = Math.min(
      REVEAL_MAX_VELOCITY,
      Math.max(REVEAL_MIN_VELOCITY, buffer * REVEAL_VELOCITY_GAIN),
    )
    const duration = (distance / velocity) * 1000

    revealAnimRef.current = {
      from: revealY,
      to: target,
      start: performance.now(),
      duration,
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    const tick = (now: number) => {
      const a = revealAnimRef.current
      if (!a) return
      const t = a.duration > 0 ? Math.min(1, (now - a.start) / a.duration) : 1
      const y = a.from + (a.to - a.from) * t
      setRevealY((prev) => Math.max(prev, y))
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        rafRef.current = null
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [contentH, isStreaming, revealY])

  // Clip the wrapper to the smooth `revealY` height so the bottom edge of
  // the visible answer moves at the curtain's pace, not in jumps as
  // contentH grows. Anything rendered as a sibling below this wrapper
  // (e.g. the references block in AnswerCard) then slides down smoothly
  // with the wrapper's height. Once revealY catches up to contentH the
  // height equals contentH and nothing is clipped.
  const heightStyle = contentH > 0 ? { height: revealY, overflow: 'hidden' as const } : undefined
  const showFade = revealY > 0 && revealY < contentH

  return (
    <div
      className="prose-stream-wrapper relative prose prose-sm max-w-none dark:prose-invert
        prose-p:text-brand-text/90 prose-p:leading-7 prose-p:my-3
        prose-headings:text-brand-text prose-headings:font-semibold
        prose-strong:text-brand-text prose-strong:font-semibold
        prose-ul:text-brand-text/90 prose-li:my-1
        prose-code:text-brand-accent-hover prose-code:bg-brand-accent/12 prose-code:rounded prose-code:px-1
        prose-a:text-brand-accent-hover prose-a:no-underline hover:prose-a:underline"
      data-has-content={displayed.length > 0 ? '' : undefined}
      style={heightStyle}
    >
      <div ref={contentRef}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          components={mdComponents as any}
        >
          {processed}
        </ReactMarkdown>
      </div>
      {/* Soft fade at the bottom edge of the visible region — keeps the
          curtain edge from looking like a hard cutoff. Only shown while
          there's still content beyond revealY (i.e. the curtain is
          actively trailing). */}
      {showFade && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-b from-transparent to-brand-bg"
          style={{ height: GRADIENT_FADE_PX }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Strip unclosed markdown markers from the live stream so the user never
// sees raw `**`, `__`, `[`, `` ` `` characters before they're closed. The
// trimmer scans for paired markers and link/image brackets and cuts the
// text back to the last fully-balanced position.
// ---------------------------------------------------------------------------
const PAIR_MARKERS = ['**', '__', '~~', '`'] as const

function findUnclosedPair(text: string, marker: string): number | null {
  const positions: number[] = []
  let i = 0
  while ((i = text.indexOf(marker, i)) !== -1) {
    positions.push(i)
    i += marker.length
  }
  return positions.length % 2 === 1 ? positions[positions.length - 1] : null
}

function trimUnclosedMarkers(text: string): string {
  if (!text) return text
  let cutoff = text.length
  for (const m of PAIR_MARKERS) {
    const pos = findUnclosedPair(text, m)
    if (pos !== null && pos < cutoff) cutoff = pos
  }
  // Unclosed link / image: a `[` with no `]`, or `[…](` with no `)`.
  const lastOpenBracket = text.lastIndexOf('[')
  if (lastOpenBracket !== -1) {
    const afterBracket = text.slice(lastOpenBracket)
    const citationLike = /^\[\d+(?:-\d+)?\]/.test(afterBracket)
    if (!citationLike) {
      const closeBracketRel = afterBracket.indexOf(']')
      if (closeBracketRel === -1) {
        if (lastOpenBracket < cutoff) cutoff = lastOpenBracket
      } else {
        const afterClose = afterBracket.slice(closeBracketRel + 1)
        if (afterClose.startsWith('(') && !afterClose.includes(')')) {
          if (lastOpenBracket < cutoff) cutoff = lastOpenBracket
        }
      }
    }
  }
  return text.slice(0, cutoff).replace(/\s+$/, '')
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
