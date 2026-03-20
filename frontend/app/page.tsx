'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, getAccessToken } from '@/lib/supabase'
import { streamSearch, fetchConversations, fetchConversationMessages, deleteConversation } from '@/lib/api'
import Navbar from '@/components/Navbar'
import AnswerCard from '@/components/AnswerCard'
import ChatInput from '@/components/ChatInput'
import ConversationSidebar from '@/components/ConversationSidebar'
import type { Citation, ChatMessage, Conversation } from '@/types'

const SAMPLE_QUERIES = [
  'First-line malaria treatment in adults',
  'Managing postpartum haemorrhage',
  'Severe malnutrition in under-5s',
  'HIV in pregnancy — ARV regimen',
]

// ---------------------------------------------------------------------------
// Renumber citations by order of first appearance in the answer text.
// e.g. if LLM writes "[3] ... [1] ... [2]", renumber to [1] [2] [3].
// ---------------------------------------------------------------------------
function renumberByAppearance(
  answer: string,
  citations: Citation[],
): { answer: string; citations: Citation[] } {
  const order: number[] = []
  const regex = /\[(\d+)\]/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(answer)) !== null) {
    const n = parseInt(match[1])
    if (!order.includes(n)) order.push(n)
  }

  // Build old → new index map
  const remap: Record<number, number> = {}
  order.forEach((oldIdx, i) => { remap[oldIdx] = i + 1 })
  // Any citations not cited in text get appended in original order
  citations.forEach((c) => {
    if (!(c.index in remap)) {
      remap[c.index] = Object.keys(remap).length + 1
    }
  })

  const newAnswer = answer.replace(/\[(\d+)\]/g, (_, n) => `[${remap[parseInt(n)] ?? n}]`)
  const newCitations = citations
    .map((c) => ({ ...c, index: remap[c.index] ?? c.index }))
    .sort((a, b) => a.index - b.index)

  return { answer: newAnswer, citations: newCitations }
}

// ---------------------------------------------------------------------------
// Thinking indicator — animated Qwiva logo ring + status text
// ---------------------------------------------------------------------------
function ThinkingIndicator({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-3 py-4">
      {/* Pulsing ring around a teal core — Qwiva brand mark */}
      <div className="relative w-7 h-7 flex-shrink-0">
        <div className="absolute inset-0 rounded-full bg-teal-500/10 animate-ping" />
        <div className="absolute inset-0 rounded-full border border-teal-500/30 animate-pulse" />
        <div className="absolute inset-[5px] rounded-full bg-teal-500 opacity-90"
          style={{ animation: 'qwivaPulse 1.8s ease-in-out infinite' }}
        />
      </div>
      <span className="text-sm text-[#6b6b6b] tracking-wide">{message}</span>

      <style>{`
        @keyframes qwivaPulse {
          0%, 100% { opacity: 0.5; transform: scale(0.85); }
          50%       { opacity: 1;   transform: scale(1.05); }
        }
      `}</style>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function HomePage() {
  const router = useRouter()
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const userScrolledUpRef = useRef(false)
  const messageCountRef = useRef(0)

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [sidebarLoading, setSidebarLoading] = useState(true)
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingConversation, setIsLoadingConversation] = useState(false)
  const [conversationError, setConversationError] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState('')
  const lastAssistantIdRef = useRef<string | null>(null)

  // ------------------------------------------------------------------
  // Auth guard + initial conversation load
  // ------------------------------------------------------------------
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/auth/login'); return }
      try {
        const token = await getAccessToken()
        if (!token) { router.push('/auth/login'); return }
        const convs = await fetchConversations(token)
        setConversations(convs)
      } catch {
        // non-fatal — sidebar just stays empty
      } finally {
        setSidebarLoading(false)
      }
    })
  }, [router])

  // ------------------------------------------------------------------
  // Scroll: only when a NEW message is added — never during token streaming
  // ------------------------------------------------------------------
  const handleScroll = useCallback(() => {
    const el = scrollAreaRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    userScrolledUpRef.current = distFromBottom > 80
  }, [])

  useEffect(() => {
    // Only scroll when the number of messages grows (new bubble added),
    // not when content of an existing message changes (token streaming).
    if (messages.length > messageCountRef.current) {
      messageCountRef.current = messages.length
      if (!userScrolledUpRef.current) {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
      }
    }
  }, [messages])

  const resetScroll = useCallback(() => {
    userScrolledUpRef.current = false
    messageCountRef.current = 0
  }, [])

  // ------------------------------------------------------------------
  // Load a past conversation
  // ------------------------------------------------------------------
  const handleSelectConversation = useCallback(async (id: string) => {
    setActiveConversationId(id)
    setMessages([])
    setIsLoading(false)
    setConversationError(null)
    setIsLoadingConversation(true)
    lastAssistantIdRef.current = null
    messageCountRef.current = 0
    userScrolledUpRef.current = false
    try {
      const token = await getAccessToken()
      if (!token) { router.push('/auth/login'); return }
      const msgs = await fetchConversationMessages(id, token)
      setMessages(msgs)
      const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant')
      lastAssistantIdRef.current = lastAssistant?.id ?? null
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'instant' }), 50)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load conversation'
      setConversationError(msg)
    } finally {
      setIsLoadingConversation(false)
    }
  }, [router])

  // ------------------------------------------------------------------
  // New conversation
  // ------------------------------------------------------------------
  function handleNew() {
    setActiveConversationId(null)
    setMessages([])
    setIsLoading(false)
    lastAssistantIdRef.current = null
    setInputValue('')
  }

  // ------------------------------------------------------------------
  // Refresh conversations sidebar
  // ------------------------------------------------------------------
  async function refreshConversations() {
    try {
      const token = await getAccessToken()
      if (!token) return
      const convs = await fetchConversations(token)
      setConversations(convs)
    } catch {
      // non-fatal
    }
  }

  // ------------------------------------------------------------------
  // Delete a conversation
  // ------------------------------------------------------------------
  async function handleDelete(id: string) {
    try {
      const token = await getAccessToken()
      if (!token) return
      await deleteConversation(id, token)
      setConversations((prev) => prev.filter((c) => c.id !== id))
      if (activeConversationId === id) {
        setActiveConversationId(null)
        setMessages([])
        lastAssistantIdRef.current = null
      }
    } catch {
      // non-fatal
    }
  }

  // ------------------------------------------------------------------
  // Main search / chat handler
  // ------------------------------------------------------------------
  async function handleSearch(query: string) {
    if (!query.trim() || isLoading) return
    setInputValue('')
    resetScroll()

    const token = await getAccessToken()
    if (!token) { router.push('/auth/login'); return }

    // Optimistic user message
    const tempUserId = `temp-${Date.now()}`
    const userMsg: ChatMessage = { id: tempUserId, role: 'user', content: query }
    setMessages((prev) => [...prev, userMsg])
    setIsLoading(true)

    // Placeholder assistant message for streaming
    const tempAssistantId = `temp-assistant-${Date.now()}`
    const assistantMsg: ChatMessage = {
      id: tempAssistantId,
      role: 'assistant',
      content: '',
      isStreaming: true,
    }
    setMessages((prev) => [...prev, assistantMsg])

    // Track the real ids resolved from SSE
    let realConversationId: string | null = activeConversationId
    let realUserMessageId: string | null = null

    try {
      for await (const event of streamSearch(
        query,
        token,
        activeConversationId,
        lastAssistantIdRef.current,
      )) {
        if (event.event === 'conversation') {
          realConversationId = event.data.conversation_id
          realUserMessageId = event.data.user_message_id
          setActiveConversationId(realConversationId)
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempUserId ? { ...m, id: realUserMessageId! } : m,
            ),
          )
          // New conversation — insert into sidebar immediately with query as provisional title
          // so the user sees it right away. The `title` SSE event will replace it with the
          // LLM-generated title once it arrives.
          if (!activeConversationId) {
            const words = query.trim().split(/\s+/)
            const provisionalTitle = words.slice(0, 6).join(' ') + (words.length > 6 ? '…' : '')
            const now = new Date().toISOString()
            setConversations((prev) => [
              {
                id: realConversationId!,
                title: provisionalTitle,
                title_generated: false,
                created_at: now,
                updated_at: now,
              },
              ...prev,
            ])
          }
        } else if (event.event === 'status') {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempAssistantId
                ? { ...m, content: '', isStreaming: true, statusMessage: event.data.message }
                : m,
            ),
          )
        } else if (event.event === 'citations') {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempAssistantId
                ? {
                    ...m,
                    citations: event.data.citations,
                    evidence_grade: event.data.evidence_grade,
                  }
                : m,
            ),
          )
        } else if (event.event === 'token') {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempAssistantId
                ? { ...m, content: m.content + event.data.token }
                : m,
            ),
          )
        } else if (event.event === 'done') {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== tempAssistantId) return m
              const { answer, citations } = renumberByAppearance(
                m.content,
                m.citations ?? [],
              )
              return { ...m, id: event.data.assistant_message_id, content: answer, citations, isStreaming: false }
            }),
          )
          // Capture real DB id for use as parent_message_id on next turn
          lastAssistantIdRef.current = event.data.assistant_message_id
        } else if (event.event === 'title') {
          // Title arrived — update sidebar in place without a full refresh
          setConversations((prev) =>
            prev.map((c) =>
              c.id === event.data.conversation_id
                ? { ...c, title: event.data.title }
                : c,
            ),
          )
        } else if (event.event === 'error') {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempAssistantId
                ? { ...m, content: event.data.detail, isStreaming: false, isError: true }
                : m,
            ),
          )
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred.'
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempAssistantId
            ? { ...m, content: msg, isStreaming: false, isError: true }
            : m,
        ),
      )
    } finally {
      setIsLoading(false)
    }
  }

  const hasMessages = messages.length > 0
  const showHero = !hasMessages && !activeConversationId && !isLoadingConversation

  return (
    <div className="flex flex-col h-screen bg-[#0f0f0f]">
      <Navbar />

      {/* Below navbar: sidebar + chat area */}
      <div className="flex flex-1 overflow-hidden pt-14">
        <ConversationSidebar
          conversations={conversations}
          activeId={activeConversationId}
          onSelect={handleSelectConversation}
          onNew={handleNew}
          onDelete={handleDelete}
          isLoading={sidebarLoading}
        />

        {/* Main chat area */}
        <main className="flex flex-col flex-1 overflow-hidden">
          {/* Message thread (scrollable) */}
          <div ref={scrollAreaRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
            {isLoadingConversation ? (
              /* Loading conversation history */
              <div className="flex items-center justify-center h-full">
                <ThinkingIndicator message="Loading conversation…" />
              </div>
            ) : conversationError ? (
              /* Failed to load */
              <div className="flex flex-col items-center justify-center h-full gap-4">
                <p className="text-sm text-red-400">{conversationError}</p>
                <button
                  onClick={() => activeConversationId && handleSelectConversation(activeConversationId)}
                  className="px-4 py-2 text-xs text-teal-400 border border-teal-500/30 rounded-full hover:border-teal-500/60 transition-all"
                >
                  Retry
                </button>
              </div>
            ) : showHero ? (
              /* Empty / hero state */
              <div className="flex flex-col items-center justify-center h-full px-4 pb-24">
                <div className="text-center mb-10">
                  <h1 className="text-4xl font-bold text-white tracking-tight mb-3">Qwiva</h1>
                  <p className="text-[#6b6b6b] text-base">
                    Kenya&apos;s clinical knowledge platform
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {SAMPLE_QUERIES.map((q) => (
                    <button
                      key={q}
                      onClick={() => handleSearch(q)}
                      disabled={isLoading}
                      className="px-3.5 py-1.5 text-xs text-[#9a9a9a] bg-[#1a1a1a] border border-[#2a2a2a] rounded-full hover:border-teal-500/40 hover:text-teal-400 transition-all disabled:opacity-50"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* Conversation thread */
              <div className="max-w-3xl mx-auto w-full px-4 py-8 space-y-6">
                {messages.map((msg) => (
                  <MessageRow key={msg.id} message={msg} />
                ))}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          {/* Fixed input at bottom */}
          <div className="border-t border-[#1a1a1a] bg-[#0f0f0f] px-4 py-4">
            <div className="max-w-3xl mx-auto w-full">
              <ChatInput
                value={inputValue}
                onChange={setInputValue}
                onSubmit={handleSearch}
                isLoading={isLoading}
                inConversation={hasMessages || activeConversationId !== null}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Individual message row
// ---------------------------------------------------------------------------
function MessageRow({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl px-4 py-3 text-sm text-[#e8e8e8] leading-relaxed whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    )
  }

  // Assistant message
  if (message.isError) {
    return (
      <div className="w-full">
        <p className="text-sm text-red-400 py-2">{message.content}</p>
      </div>
    )
  }

  // Show animated indicator while waiting for first token
  if (message.isStreaming && !message.content) {
    return (
      <div className="w-full">
        <ThinkingIndicator message={message.statusMessage ?? 'Searching guidelines…'} />
      </div>
    )
  }

  return (
    <div className="w-full">
      <AnswerCard
        answer={message.content}
        citations={message.citations ?? []}
        isStreaming={message.isStreaming ?? false}
        isDone={!message.isStreaming}
      />
    </div>
  )
}
