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
      <div className="flex gap-2 p-1 bg-white border border-gray-200 rounded-xl shadow-sm focus-within:ring-2 focus-within:ring-teal-500 focus-within:border-transparent transition-all">
        <input
          ref={inputRef}
          type="text"
          placeholder="Ask a clinical question…"
          disabled={isLoading}
          className="flex-1 px-4 py-3 text-gray-800 placeholder-gray-400 bg-transparent outline-none text-base disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={isLoading}
          className="px-5 py-2.5 text-sm font-semibold text-white bg-teal-600 rounded-lg hover:bg-teal-700 active:bg-teal-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? 'Searching…' : 'Search'}
        </button>
      </div>
    </form>
  )
}
