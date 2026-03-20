import type { SSEEvent, Conversation, ChatMessage } from '@/types'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

/**
 * Opens a streaming search request and yields parsed SSE events.
 * Caller is responsible for providing a valid Supabase access token.
 */
export async function* streamSearch(
  query: string,
  token: string,
  conversationId?: string | null,
  parentMessageId?: string | null,
): AsyncGenerator<SSEEvent> {
  const body: Record<string, string | null> = { query }
  if (conversationId !== undefined) body.conversation_id = conversationId ?? null
  if (parentMessageId !== undefined) body.parent_message_id = parentMessageId ?? null

  const response = await fetch(`${API_URL}/search/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Search failed (${response.status}): ${text}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('Response body is not readable')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const blocks = buffer.split('\n\n')
    // Keep the last (possibly incomplete) block in the buffer
    buffer = blocks.pop() ?? ''

    for (const block of blocks) {
      const parsed = parseSSEBlock(block)
      if (parsed) yield parsed
    }
  }
}

function parseSSEBlock(block: string): SSEEvent | null {
  let event = ''
  let data = ''

  for (const line of block.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice(7).trim()
    else if (line.startsWith('data: ')) data = line.slice(6).trim()
  }

  if (!event || !data) return null

  try {
    return { event, data: JSON.parse(data) } as SSEEvent
  } catch {
    return null
  }
}

export async function fetchConversations(token: string): Promise<Conversation[]> {
  const response = await fetch(`${API_URL}/conversations`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`Failed to fetch conversations (${response.status})`)
  return response.json()
}

export async function deleteConversation(
  conversationId: string,
  token: string,
): Promise<void> {
  const response = await fetch(`${API_URL}/conversations/${conversationId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok && response.status !== 204) {
    throw new Error(`Failed to delete conversation (${response.status})`)
  }
}

export async function fetchConversationMessages(
  conversationId: string,
  token: string,
): Promise<ChatMessage[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  let response: Response
  try {
    response = await fetch(`${API_URL}/conversations/${conversationId}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) throw new Error(`Failed to fetch messages (${response.status})`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any[] = await response.json()

  return raw.map((msg) => {
    // citations may arrive as a JSON string (stored via json.dumps) or already parsed
    let citations = msg.citations ?? undefined
    if (typeof citations === 'string') {
      try { citations = JSON.parse(citations) } catch { citations = undefined }
    }
    return {
      id: msg.id,
      role: msg.role as 'user' | 'assistant',
      content: msg.content ?? '',
      citations,
      evidence_grade: msg.evidence_grade ?? undefined,
      isStreaming: false,
      isError: false,
    }
  })
}
