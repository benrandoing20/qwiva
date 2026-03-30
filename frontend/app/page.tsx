'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import posthog from 'posthog-js'
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

  // Build old → new index map — only for citations actually referenced inline
  const remap: Record<number, number> = {}
  order.forEach((oldIdx, i) => { remap[oldIdx] = i + 1 })

  const newAnswer = answer.replace(/\[(\d+)\]/g, (_, n) => `[${remap[parseInt(n)] ?? n}]`)
  const newCitations = citations
    .filter((c) => c.index in remap)
    .map((c) => ({ ...c, index: remap[c.index] }))
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
  // Mirrors activeConversationId as a ref so async stream closures can read the
  // current value without capturing a stale closure.
  const activeConversationIdRef = useRef<string | null>(null)
  // Background streams: conversations that finished loading while the user was elsewhere.
  const [backgroundDone, setBackgroundDone] = useState<{ conversationId: string; title: string }[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // Generation counter: incremented on each new search so the previous stream's
  // finally block doesn't clobber isLoading for a newly started stream.
  const streamGenRef = useRef(0)

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
      } catch (err) {
        console.error('Failed to load conversations:', err)
      } finally {
        setSidebarLoading(false)
      }
    })
  }, [router])

  // Keep ref in sync so async closures can read the current conversation id
  useEffect(() => {
    activeConversationIdRef.current = activeConversationId
  }, [activeConversationId])

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
    setSidebarOpen(false)
    setActiveConversationId(id)
    // Don't clear messages immediately — keep old content visible while fetching
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
      // Swap messages in a single update so there's no blank frame
      setMessages(msgs)
      const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant')
      lastAssistantIdRef.current = lastAssistant?.id ?? null
      // Scroll after paint so layout is stable
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'instant' })
      })
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
    } catch (err) {
      console.error('Failed to refresh conversations:', err)
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
    } catch (err) {
      console.error('Failed to delete conversation:', err)
    }
  }

  // ------------------------------------------------------------------
  // Main search / chat handler
  // ------------------------------------------------------------------
  async function handleSearch(query: string) {
    if (!query.trim() || isLoading) return
    posthog.capture('search_submitted', {
      query_length: query.length,
      is_followup: messages.length > 0,
    })
    setInputValue('')
    resetScroll()

    const token = await getAccessToken()
    if (!token) { router.push('/auth/login'); return }

    // Increment generation so this stream "owns" isLoading
    streamGenRef.current += 1
    const myGen = streamGenRef.current

    // Optimistic user message
    const tempUserId = `temp-${Date.now()}`
    const userMsg: ChatMessage = { id: tempUserId, stableKey: tempUserId, role: 'user', content: query }
    setMessages((prev) => [...prev, userMsg])
    setIsLoading(true)

    // Placeholder assistant message for streaming
    const tempAssistantId = `temp-assistant-${Date.now()}`
    const assistantMsg: ChatMessage = {
      id: tempAssistantId,
      stableKey: tempAssistantId,
      role: 'assistant',
      content: '',
      isStreaming: true,
    }
    setMessages((prev) => [...prev, assistantMsg])

    // Track the real ids resolved from SSE
    let realConversationId: string | null = activeConversationId
    let realUserMessageId: string | null = null
    let pendingSuggestions: string[] = []

    // Token buffer — accumulate tokens and flush every animation frame (~16ms)
    // instead of calling setMessages on every single token (30–50x/sec with fast models)
    let tokenBuffer = ''
    let rafId: number | null = null
    const flushTokens = () => {
      if (!tokenBuffer) return
      const toFlush = tokenBuffer
      tokenBuffer = ''
      rafId = null
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempAssistantId ? { ...m, content: m.content + toFlush } : m,
        ),
      )
    }

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
          // Don't add to sidebar yet — wait for the title SSE event so it appears
          // with the real title already set (no empty → title flash).
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
          tokenBuffer += event.data.token
          if (!rafId) rafId = requestAnimationFrame(flushTokens)
        } else if (event.event === 'suggestions') {
          pendingSuggestions = event.data.suggestions
        } else if (event.event === 'done') {
          // Cancel any pending rAF flush and fold buffered tokens directly into
          // this update — single atomic render, no double-flash.
          if (rafId) { cancelAnimationFrame(rafId); rafId = null }
          const pendingTokens = tokenBuffer
          tokenBuffer = ''
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== tempAssistantId) return m
              const fullContent = m.content + pendingTokens
              const { answer, citations } = renumberByAppearance(
                fullContent,
                m.citations ?? [],
              )
              return {
                ...m,
                id: event.data.assistant_message_id,
                content: answer,
                citations,
                isStreaming: false,
                suggestions: pendingSuggestions.length > 0 ? pendingSuggestions : undefined,
              }
            }),
          )
          // Capture real DB id for use as parent_message_id on next turn
          lastAssistantIdRef.current = event.data.assistant_message_id

          // If user navigated away during streaming, show a notification bubble
          if (realConversationId && activeConversationIdRef.current !== realConversationId) {
            setConversations((prev) => {
              const conv = prev.find((c) => c.id === realConversationId)
              setBackgroundDone((bd) => {
                if (bd.some((b) => b.conversationId === realConversationId)) return bd
                return [...bd, {
                  conversationId: realConversationId!,
                  title: conv?.title ?? 'Your search',
                }]
              })
              return prev
            })
          }
        } else if (event.event === 'title') {
          setConversations((prev) => {
            const exists = prev.some((c) => c.id === event.data.conversation_id)
            if (exists) {
              // Existing conversation — update title in place
              return prev.map((c) =>
                c.id === event.data.conversation_id ? { ...c, title: event.data.title } : c,
              )
            }
            // New conversation — add to sidebar now that we have the real title
            const now = new Date().toISOString()
            return [
              {
                id: event.data.conversation_id,
                title: event.data.title,
                title_generated: true,
                created_at: now,
                updated_at: now,
              },
              ...prev,
            ]
          })
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
      // Only clear isLoading if this is still the current stream
      if (streamGenRef.current === myGen) setIsLoading(false)
    }
  }

  function handleSuggestionClick(suggestion: string) {
    posthog.capture('suggestion_clicked', { suggestion })
    handleSearch(suggestion)
  }

  const hasMessages = messages.length > 0
  const showHero = !hasMessages && !activeConversationId && !isLoadingConversation

  return (
    <div className="flex flex-col h-screen bg-[#0f0f0f]">
      <Navbar onToggleSidebar={() => setSidebarOpen(v => !v)} />

      {/* Below navbar: sidebar + chat area */}
      <div className="flex flex-1 overflow-hidden pt-14">
        <ConversationSidebar
          conversations={conversations}
          activeId={activeConversationId}
          onSelect={handleSelectConversation}
          onNew={handleNew}
          onDelete={handleDelete}
          isLoading={sidebarLoading}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />

        {/* Main chat area */}
        <main className="flex flex-col flex-1 overflow-hidden">
          {/* Message thread (scrollable) */}
          <div ref={scrollAreaRef} onScroll={handleScroll} className="flex-1 overflow-y-auto relative">
            {conversationError ? (
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
              <div
                className="max-w-3xl mx-auto w-full px-4 py-8 space-y-6 transition-opacity duration-200"
                style={{ opacity: isLoadingConversation ? 0.35 : 1 }}
              >
                {messages.map((msg) => (
                  <MessageRow key={msg.stableKey ?? msg.id} message={msg} onSuggest={handleSuggestionClick} />
                ))}
                <div ref={bottomRef} />
              </div>
            )}

            {/* Fade overlay while switching conversations — sits on top of dimmed messages */}
            {isLoadingConversation && messages.length > 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <ThinkingIndicator message="Loading conversation…" />
              </div>
            )}

            {/* Full-screen loader only for the first load (no previous messages to show) */}
            {isLoadingConversation && messages.length === 0 && (
              <div className="flex items-center justify-center h-full">
                <ThinkingIndicator message="Loading conversation…" />
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

      {/* Background stream notifications */}
      {backgroundDone.length > 0 && (
        <div className="fixed bottom-24 right-4 z-50 flex flex-col gap-2">
          {backgroundDone.map((item) => (
            <BackgroundDoneToast
              key={item.conversationId}
              item={item}
              onNavigate={(id) => {
                handleSelectConversation(id)
                setBackgroundDone((prev) => prev.filter((b) => b.conversationId !== id))
              }}
              onDismiss={(id) => setBackgroundDone((prev) => prev.filter((b) => b.conversationId !== id))}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Background stream notification bubble
// ---------------------------------------------------------------------------
function BackgroundDoneToast({
  item,
  onNavigate,
  onDismiss,
}: {
  item: { conversationId: string; title: string }
  onNavigate: (id: string) => void
  onDismiss: (id: string) => void
}) {
  return (
    <div className="flex items-center gap-2.5 bg-[#1a1a1a] border border-teal-500/30 rounded-xl px-3.5 py-2.5 shadow-xl max-w-xs">
      <div className="w-2 h-2 rounded-full bg-teal-500 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-[#6b6b6b] mb-0.5">Answer ready</p>
        <p className="text-xs text-[#e8e8e8] truncate">{item.title}</p>
      </div>
      <button
        onClick={() => onNavigate(item.conversationId)}
        className="text-xs text-teal-400 hover:text-teal-300 transition-colors flex-shrink-0"
      >
        View →
      </button>
      <button
        onClick={() => onDismiss(item.conversationId)}
        className="text-[#4a4a4a] hover:text-[#9a9a9a] transition-colors flex-shrink-0 ml-0.5"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Individual message row
// ---------------------------------------------------------------------------
function MessageRow({ message, onSuggest }: { message: ChatMessage; onSuggest?: (q: string) => void }) {
  if (message.role === 'user') {
    return (
      <div className={`flex justify-end${message.stableKey ? ' animate-fadeIn' : ''}`}>
        <div className="max-w-[80%] bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl px-4 py-3 text-sm text-[#e8e8e8] leading-relaxed whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    )
  }

  // Assistant message
  if (message.isError) {
    return (
      <div className={`w-full${message.stableKey ? ' animate-fadeIn' : ''}`}>
        <p className="text-sm text-red-400 py-2">{message.content}</p>
      </div>
    )
  }

  // Always render AnswerCard — it handles the empty/thinking state internally.
  // This avoids a DOM swap when the first token arrives, which causes layout jitter.
  return (
    <div className={`w-full${message.stableKey ? ' animate-fadeIn' : ''}`}>
      <AnswerCard
        answer={message.content}
        citations={message.citations ?? []}
        isStreaming={message.isStreaming ?? false}
        isDone={!message.isStreaming}
        statusMessage={message.statusMessage}
        suggestions={message.suggestions}
        onSuggest={onSuggest}
      />
    </div>
  )
}
