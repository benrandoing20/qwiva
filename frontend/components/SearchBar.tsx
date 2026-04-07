'use client'

import { FormEvent, useRef } from 'react'

interface Props {
  onSearch: (query: string) => void
  isLoading: boolean
}

export default function SearchBar({ onSearch, isLoading }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const query = inputRef.current?.value.trim()
    if (query) onSearch(query)
  }

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="flex items-center gap-2 px-4 py-3 bg-brand-surface border border-brand-border rounded-2xl focus-within:border-brand-accent/45 focus-within:ring-1 focus-within:ring-brand-accent/15 transition-all">
        <input
          ref={inputRef}
          type="text"
          placeholder="Ask a clinical question…"
          disabled={isLoading}
          className="flex-1 bg-transparent text-brand-text placeholder-brand-subtle text-base outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isLoading}
          className="flex-shrink-0 flex items-center justify-center w-9 h-9 bg-brand-accent hover:bg-brand-accent-hover disabled:opacity-40 disabled:cursor-not-allowed rounded-xl transition-colors shadow-[0_0_20px_-4px_rgba(168,85,247,0.5)]"
        >
          {isLoading ? (
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          )}
        </button>
      </div>
    </form>
  )
}
