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
      <div className="flex items-center gap-2 px-4 py-3 bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl focus-within:border-teal-500/50 focus-within:ring-1 focus-within:ring-teal-500/20 transition-all">
        <input
          ref={inputRef}
          type="text"
          placeholder="Ask a clinical question…"
          disabled={isLoading}
          className="flex-1 bg-transparent text-[#e8e8e8] placeholder-[#4a4a4a] text-base outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isLoading}
          className="flex-shrink-0 flex items-center justify-center w-9 h-9 bg-teal-500 hover:bg-teal-400 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl transition-colors"
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
