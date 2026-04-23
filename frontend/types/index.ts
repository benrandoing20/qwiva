export interface Citation {
  index: number
  guideline_title: string
  section: string
  year: string
  publisher: string
  doc_type?: string        // "guideline" | "drug" | "legacy"
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

// ---------------------------------------------------------------------------
// Social — Profiles
// ---------------------------------------------------------------------------

export interface PhysicianProfile {
  user_id: string
  display_name: string
  specialty?: string | null
  subspecialty?: string | null
  institution?: string | null
  country: string
  city?: string | null
  bio?: string | null
  avatar_url?: string | null
  years_experience?: number | null
  verification_status: 'unverified' | 'pending' | 'verified'
  languages: string[]
  interests: string[]
  onboarding_complete: boolean
  follower_count: number
  following_count: number
  post_count: number
  created_at: string
  is_following?: boolean | null
}

// ---------------------------------------------------------------------------
// Social — Posts
// ---------------------------------------------------------------------------

export type PostType = 'question' | 'case_discussion' | 'clinical_pearl' | 'resource'

export interface Post {
  id: string
  author_id: string
  content: string
  post_type: PostType
  tags: string[]
  specialty_tags: string[]
  image_urls: string[]
  is_anonymous: boolean
  like_count: number
  comment_count: number
  view_count: number
  created_at: string
  author_name: string
  author_specialty?: string | null
  author_avatar?: string | null
  author_country?: string | null
  author_verified: string
  viewer_liked: boolean
  is_following: boolean
}

// ---------------------------------------------------------------------------
// Social — Comments
// ---------------------------------------------------------------------------

export interface Comment {
  id: string
  post_id: string
  author_id: string
  parent_comment_id?: string | null
  content: string
  is_anonymous: boolean
  like_count: number
  created_at: string
  author_name: string
  author_specialty?: string | null
  author_avatar?: string | null
  author_verified: string
  viewer_liked: boolean
}

// ---------------------------------------------------------------------------
// Social — Discover
// ---------------------------------------------------------------------------

export interface DiscoverUser {
  user_id: string
  display_name: string
  specialty?: string | null
  subspecialty?: string | null
  institution?: string | null
  country: string
  city?: string | null
  bio?: string | null
  avatar_url?: string | null
  years_experience?: number | null
  verification_status: string
  languages: string[]
  interests: string[]
  follower_count: number
  following_count: number
  post_count: number
  is_following: boolean
}

export interface LikeResponse {
  liked: boolean
  like_count: number
}

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
