'use client'

import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'

interface Props {
  text: string
  isStreaming: boolean
}

export default function StreamingText({ text, isStreaming }: Props) {
  const displayed = useTypewriter(text, isStreaming)
  const compressed = compressCitations(displayed)
  const processed = compressed.replace(/\[(\d+(?:-\d+)?)\]/g, '<cite data-n="$1">$1</cite>')

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
          cite: ({ 'data-n': n }: { 'data-n': string }) => (
            <sup>
              <span className="inline-flex items-center justify-center w-4 h-4 ml-0.5 text-[9px] font-bold text-teal-400 bg-teal-500/10 border border-teal-500/20 rounded-full cursor-default select-none">
                {n}
              </span>
            </sup>
          ),
        }}
      >
        {processed}
      </ReactMarkdown>
      {isStreaming && (
        <span className="inline-block w-0.5 h-[1em] ml-px bg-teal-400 animate-pulse align-text-bottom" />
      )}
    </div>
  )
}

// Compress adjacent citation runs: [1][2][3] → [1-3], [1][2][4] → [1-2][4]
function compressCitations(text: string): string {
  return text.replace(/(\[\d+\])+/g, (match) => {
    const nums = [...match.matchAll(/\[(\d+)\]/g)]
      .map((m) => parseInt(m[1]))
      .sort((a, b) => a - b)

    const ranges: string[] = []
    let start = nums[0]
    let end = nums[0]

    for (let i = 1; i < nums.length; i++) {
      if (nums[i] === end + 1) {
        end = nums[i]
      } else {
        ranges.push(start === end ? `[${start}]` : `[${start}-${end}]`)
        start = nums[i]
        end = nums[i]
      }
    }
    ranges.push(start === end ? `[${start}]` : `[${start}-${end}]`)
    return ranges.join('')
  })
}

function useTypewriter(fullText: string, isStreaming: boolean): string {
  const [displayed, setDisplayed] = useState('')
  const fullTextRef = useRef(fullText)
  const posRef = useRef(0)

  fullTextRef.current = fullText

  useEffect(() => {
    if (!isStreaming) {
      setDisplayed(fullText)
      posRef.current = fullText.length
      return
    }
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
