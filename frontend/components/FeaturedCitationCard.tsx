'use client'

import type { Citation } from '@/types'

function docType(c: Citation): 'drug' | 'guideline' {
  return c.doc_type === 'drug' ? 'drug' : 'guideline'
}

function badge(pub: string, year: string): string {
  const acr = pub.match(/\b(WHO|RCOG|KDIGO|NICE|CDC|AHA|ACC|ESC|FIGO|ICM|ACOG|ACSM|NHS|FDA)\b/i)
           ?? pub.match(/\(([A-Z]{2,6})\)/)
  const abbr = acr ? acr[1].toUpperCase() : (pub.split(/[\s,;(]/)[0]?.slice(0, 6) ?? '')
  return year ? `${abbr} ${year}` : abbr
}


export default function FeaturedCitationCard({ citation: c }: { citation: Citation }) {
  const type  = docType(c)
  const label = type === 'drug' ? 'Prescribing Information' : 'Practice Guideline'
  const bdg   = badge(c.publisher ?? '', c.year ?? '')

  // Render section path as breadcrumbs (separator: " › ")
  const crumbs = c.section
    ? c.section.split(/\s*[>/|]\s*/).map(s => s.trim()).filter(Boolean)
    : []

  return (
    <div className="rounded-xl border border-brand-border overflow-hidden animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-brand-navy">
        <div className="flex items-center gap-2 text-xs font-semibold text-brand-text/75">
          {type === 'drug' ? <PillIcon /> : <ClipboardIcon />}
          {label}
        </div>
        {bdg && (
          <span className="text-[10px] font-bold text-brand-text/60 bg-white/10 px-2 py-0.5 rounded">
            {bdg}
          </span>
        )}
      </div>

      {/* Body — guideline title + section breadcrumb path */}
      <div className="px-4 py-4 bg-brand-surface space-y-2">
        <p className="text-sm font-semibold text-brand-text leading-snug">
          {c.guideline_title}
        </p>

        {crumbs.length > 0 && (
          <p className="text-[11px] text-brand-muted leading-relaxed">
            {crumbs.map((crumb, i) => (
              <span key={i}>
                {i > 0 && <span className="mx-1 opacity-40">›</span>}
                <span className={i === crumbs.length - 1 ? 'text-brand-text/70' : ''}>
                  {crumb}
                </span>
              </span>
            ))}
          </p>
        )}

        <p className="text-[11px] text-brand-subtle">
          {[c.publisher, c.year].filter(Boolean).join(' · ')}
        </p>

        {c.source_url && (
          <a
            href={c.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-brand-accent hover:text-brand-accent-hover transition-colors mt-1"
          >
            View guideline ↗
          </a>
        )}
      </div>
    </div>
  )
}

function ClipboardIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="2" width="6" height="4" rx="1" />
      <path d="M9 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-2" />
      <line x1="9" y1="12" x2="15" y2="12" />
      <line x1="9" y1="16" x2="13" y2="16" />
    </svg>
  )
}

function PillIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" />
      <line x1="8.5" y1="8.5" x2="15.5" y2="15.5" />
    </svg>
  )
}
