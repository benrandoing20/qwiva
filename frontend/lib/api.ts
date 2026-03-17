import type { SSEEvent } from '@/types'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

/**
 * Opens a streaming search request and yields parsed SSE events.
 * Caller is responsible for providing a valid Supabase access token.
 */
export async function* streamSearch(
  query: string,
  token: string,
): AsyncGenerator<SSEEvent> {
  const response = await fetch(`${API_URL}/search/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query }),
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
