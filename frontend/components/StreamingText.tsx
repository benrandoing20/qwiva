'use client'

import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'

interface Props {
  text: string
  isStreaming: boolean
}

/**
 * Renders markdown with inline citation badges and a smooth typewriter reveal.
 * Characters are revealed at ~60fps so the output feels continuous rather than
 * arriving in network-chunk bursts.
 */
export default function StreamingText({ text, isStreaming }: Props) {
  const displayed = useTypewriter(text, isStreaming)
  const processed = displayed.replace(/\[(\d+)\]/g, '<cite data-n="$1">$1</cite>')

  return (
    <div className="prose prose-sm prose-gray max-w-none
      prose-headings:font-semibold prose-headings:text-gray-900
      prose-strong:font-semibold prose-strong:text-gray-900
      prose-ul:my-2 prose-li:my-0.5
      prose-p:leading-relaxed prose-p:my-2 prose-p:text-gray-800">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          // @ts-expect-error — custom HTML element
          cite: ({ 'data-n': n }: { 'data-n': string }) => (
            <sup>
              <span className="inline-flex items-center justify-center w-4 h-4 ml-0.5 text-[9px] font-bold text-teal-700 bg-teal-50 border border-teal-200 rounded-full cursor-default select-none">
                {n}
              </span>
            </sup>
          ),
        }}
      >
        {processed}
      </ReactMarkdown>
      {isStreaming && (
        <span className="inline-block w-0.5 h-[1em] ml-px bg-teal-500 animate-pulse align-text-bottom" />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Typewriter hook — reveals text at ~4 chars per frame (≈60fps)
// ---------------------------------------------------------------------------

function useTypewriter(fullText: string, isStreaming: boolean): string {
  const [displayed, setDisplayed] = useState('')
  const fullTextRef = useRef(fullText)
  const posRef = useRef(0)

  // Keep ref current so the interval always reads the latest value
  fullTextRef.current = fullText

  useEffect(() => {
    if (!isStreaming) {
      // Streaming ended — snap to complete text immediately
      setDisplayed(fullText)
      posRef.current = fullText.length
      return
    }

    // Reset when a new search starts (text went back to empty)
    if (fullText === '') {
      setDisplayed('')
      posRef.current = 0
      return
    }

    const id = setInterval(() => {
      const target = fullTextRef.current
      if (posRef.current < target.length) {
        posRef.current = Math.min(posRef.current + 4, target.length)
        setDisplayed(target.slice(0, posRef.current))
      }
    }, 16)

    return () => clearInterval(id)
  }, [isStreaming, fullText === '']) // eslint-disable-line react-hooks/exhaustive-deps

  return displayed
}
