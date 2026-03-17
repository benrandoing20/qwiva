export interface Citation {
  index: number
  guideline_title: string
  section: string
  year: string
  publisher: string
}

export interface CitationsPayload {
  citations: Citation[]
  evidence_grade: string
}

export interface TokenPayload {
  token: string
}

export type SSEEvent =
  | { event: 'status'; data: { message: string } }
  | { event: 'citations'; data: CitationsPayload }
  | { event: 'token'; data: TokenPayload }
  | { event: 'done'; data: Record<string, never> }
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
