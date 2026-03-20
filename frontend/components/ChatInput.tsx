'use client'

import { useRef, useEffect, KeyboardEvent } from 'react'

interface Props {
  value: string
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  isLoading: boolean
  inConversation?: boolean
}

export default function ChatInput({ value, onChange, onSubmit, isLoading, inConversation }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-grow textarea up to ~5 lines
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const lineHeight = 24
    const maxHeight = lineHeight * 5 + 32 // 5 lines + padding
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
  }, [value])

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  function handleSubmit() {
    const trimmed = value.trim()
    if (!trimmed || isLoading) return
    onSubmit(trimmed)
  }

  return (
    <div className="flex items-end gap-3 w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl px-4 py-3 focus-within:border-teal-500/50 transition-colors">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isLoading}
        placeholder={inConversation ? 'Ask a follow-up…' : 'Ask a clinical question…'}
        rows={1}
        className="flex-1 bg-transparent text-[#e8e8e8] placeholder-[#4a4a4a] text-sm resize-none outline-none leading-6 disabled:opacity-50 min-h-[24px]"
      />
      <button
        onClick={handleSubmit}
        disabled={isLoading || !value.trim()}
        className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-xl bg-teal-500 hover:bg-teal-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        aria-label="Send"
      >
        {isLoading ? (
          <span className="flex gap-0.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-1 h-1 bg-white rounded-full animate-bounce"
                style={{ animationDelay: `${i * 100}ms` }}
              />
            ))}
          </span>
        ) : (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-white"
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        )}
      </button>
    </div>
  )
}
