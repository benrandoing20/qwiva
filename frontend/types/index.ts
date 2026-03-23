export interface Citation {
  index: number
  guideline_title: string
  section: string
  year: string
  publisher: string
  source_url?: string
  excerpt?: string         // 400-char display excerpt
  source_content?: string  // full retrieved chunk — shown in hover tooltip
}

export interface CitationsPayload {
  citations: Citation[]
  evidence_grade: string
}

export interface TokenPayload {
  token: string
}

export type SSEEvent =
  | { event: 'conversation'; data: { conversation_id: string; user_message_id: string } }
  | { event: 'status'; data: { message: string } }
  | { event: 'citations'; data: CitationsPayload }
  | { event: 'token'; data: TokenPayload }
  | { event: 'done'; data: { assistant_message_id: string } }
  | { event: 'title'; data: { conversation_id: string; title: string } }
  | { event: 'suggestions'; data: { suggestions: string[] } }
  | { event: 'error'; data: { detail: string } }

export type SearchStatus = 'idle' | 'searching' | 'streaming' | 'done' | 'error'

export interface SearchState {
  status: SearchStatus
  statusMessage: string
  answer: string
  citations: Citation[]
  evidence_grade: string
  error: string | null
}

export interface Conversation {
  id: string
  title: string | null
  title_generated: boolean
  created_at: string
  updated_at: string
}

export interface ChatMessage {
  id: string
  stableKey?: string  // set once at creation, never changed — used as React key to prevent remounts
  role: 'user' | 'assistant'
  content: string
  citations?: Citation[]
  evidence_grade?: string
  isStreaming?: boolean
  isError?: boolean
  statusMessage?: string
  suggestions?: string[]
}
