// Shared types — kept in sync with frontend/types/index.ts.
// When you add a field here, mirror it on the web side.

export interface Citation {
  index: number;
  guideline_title: string;
  section: string;
  year: string;
  publisher: string;
  doc_type?: string;
  source_url?: string;
  excerpt?: string;
  source_content?: string;
}

export interface CitationsPayload {
  citations: Citation[];
  evidence_grade: string;
}

export interface TokenPayload {
  token: string;
}

export type SSEEvent =
  | { event: 'conversation'; data: { conversation_id: string; user_message_id: string } }
  | { event: 'status'; data: { message: string } }
  | { event: 'citations'; data: CitationsPayload }
  | { event: 'token'; data: TokenPayload }
  | { event: 'done'; data: { assistant_message_id: string } }
  | { event: 'title'; data: { conversation_id: string; title: string } }
  | { event: 'suggestions'; data: { suggestions: string[] } }
  | { event: 'error'; data: { detail: string } };

// ---------------------------------------------------------------------------
// Social — Profiles
// ---------------------------------------------------------------------------

export interface PhysicianProfile {
  user_id: string;
  display_name: string;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  cadre?: string | null;
  registration_number?: string | null;
  specialties?: string[];
  current_rotation?: string[];
  specialty?: string | null;
  subspecialty?: string | null;
  institution?: string | null;
  country: string;
  city?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  years_experience?: number | null;
  verification_status: 'unverified' | 'pending' | 'verified';
  languages: string[];
  interests: string[];
  onboarding_complete: boolean;
  role?: string;
  follower_count: number;
  following_count: number;
  post_count: number;
  created_at: string;
  is_following?: boolean | null;
}

// ---------------------------------------------------------------------------
// Social — Posts
// ---------------------------------------------------------------------------

export type PostType = 'question' | 'case_discussion' | 'clinical_pearl' | 'resource';

export interface Post {
  id: string;
  author_id: string;
  content: string;
  post_type: PostType;
  tags: string[];
  specialty_tags: string[];
  image_urls: string[];
  is_anonymous: boolean;
  like_count: number;
  comment_count: number;
  view_count: number;
  created_at: string;
  author_name: string;
  author_specialty?: string | null;
  author_avatar?: string | null;
  author_country?: string | null;
  author_verified: string;
  viewer_liked: boolean;
  is_following: boolean;
}

export interface Comment {
  id: string;
  post_id: string;
  author_id: string;
  parent_comment_id?: string | null;
  content: string;
  is_anonymous: boolean;
  like_count: number;
  created_at: string;
  author_name: string;
  author_specialty?: string | null;
  author_avatar?: string | null;
  author_verified: string;
  viewer_liked: boolean;
}

export interface DiscoverUser {
  user_id: string;
  display_name: string;
  specialty?: string | null;
  subspecialty?: string | null;
  institution?: string | null;
  country: string;
  city?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  years_experience?: number | null;
  verification_status: string;
  languages: string[];
  interests: string[];
  follower_count: number;
  following_count: number;
  post_count: number;
  is_following: boolean;
}

export interface LikeResponse {
  liked: boolean;
  like_count: number;
}

// ---------------------------------------------------------------------------
// Search — client-side state
// ---------------------------------------------------------------------------

export type SearchStatus = 'idle' | 'searching' | 'streaming' | 'done' | 'error';

export interface SearchState {
  status: SearchStatus;
  statusMessage: string;
  answer: string;
  citations: Citation[];
  evidence_grade: string;
  error: string | null;
}

export interface Conversation {
  id: string;
  title: string | null;
  title_generated: boolean;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  stableKey?: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  evidence_grade?: string;
  isStreaming?: boolean;
  isError?: boolean;
  statusMessage?: string;
  suggestions?: string[];
}

// ---------------------------------------------------------------------------
// Surveys
// ---------------------------------------------------------------------------

export type QuestionType = 'multiple_choice' | 'multi_select' | 'scale' | 'open_text';
export type SurveyStatus = 'draft' | 'active' | 'closed';

export interface SurveyQuestionOption {
  id: string;
  text: string;
}

export interface SurveyQuestion {
  id: string;
  survey_id: string;
  question_text: string;
  question_type: QuestionType;
  options?: SurveyQuestionOption[] | null;
  scale_min?: number | null;
  scale_max?: number | null;
  scale_min_label?: string | null;
  scale_max_label?: string | null;
  is_required: boolean;
  order_index: number;
}

export interface Survey {
  id: string;
  created_by: string;
  title: string;
  description?: string | null;
  specialty_tags: string[];
  status: SurveyStatus;
  is_anonymous: boolean;
  estimated_minutes?: number | null;
  response_count: number;
  starts_at?: string | null;
  ends_at?: string | null;
  created_at: string;
  updated_at: string;
  has_responded: boolean;
  questions?: SurveyQuestion[] | null;
}

export interface SurveyAnswerInput {
  question_id: string;
  answer_text?: string | null;
  answer_options?: string[] | null;
}

export interface SurveyResultQuestion {
  question_id: string;
  question_text: string;
  question_type: QuestionType;
  total_responses: number;
  option_counts?: Record<string, number> | null;
  scale_distribution?: Record<number, number> | null;
  open_text_responses?: string[] | null;
  average_scale?: number | null;
}

export interface SurveyResults {
  survey_id: string;
  title: string;
  status: SurveyStatus;
  response_count: number;
  questions: SurveyResultQuestion[];
}
