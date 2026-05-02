// Mobile API client. Mirror of frontend/lib/api.ts.
// Uses expo/fetch for full streaming support in Expo Go.
import { fetch as expoFetch } from 'expo/fetch';
import type {
  SSEEvent,
  Conversation,
  ChatMessage,
  PhysicianProfile,
  Post,
  Comment,
  DiscoverUser,
  LikeResponse,
  PostType,
  Survey,
  SurveyAnswerInput,
  SurveyResults,
  SurveyStatus,
} from '@/types';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';

// expo/fetch returns a streaming Response whose body is a ReadableStream
// of Uint8Array chunks. We decode and split on SSE block boundaries.
export async function* streamSearch(
  query: string,
  token: string,
  conversationId?: string | null,
  parentMessageId?: string | null,
): AsyncGenerator<SSEEvent> {
  const body: Record<string, string | null> = { query };
  if (conversationId !== undefined) body.conversation_id = conversationId ?? null;
  if (parentMessageId !== undefined) body.parent_message_id = parentMessageId ?? null;

  const response = await expoFetch(`${API_URL}/search/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Search failed (${response.status}): ${text}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('Response body is not readable');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';

    for (const block of blocks) {
      const parsed = parseSSEBlock(block);
      if (parsed) yield parsed;
    }
  }
}

function parseSSEBlock(block: string): SSEEvent | null {
  let event = '';
  let data = '';

  for (const line of block.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice(7).trim();
    else if (line.startsWith('data: ')) data = line.slice(6).trim();
  }

  if (!event || !data) return null;

  try {
    return { event, data: JSON.parse(data) } as SSEEvent;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Generic helper
// ---------------------------------------------------------------------------

type FetchInit = Parameters<typeof globalThis.fetch>[1];

async function apiFetch<T>(path: string, token: string, init?: FetchInit): Promise<T> {
  const res = await globalThis.fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export async function fetchConversations(token: string): Promise<Conversation[]> {
  return apiFetch('/conversations', token);
}

export async function deleteConversation(conversationId: string, token: string): Promise<void> {
  return apiFetch(`/conversations/${conversationId}`, token, { method: 'DELETE' });
}

export async function fetchConversationMessages(
  conversationId: string,
  token: string,
): Promise<ChatMessage[]> {
  type RawMessage = {
    id: string;
    role: string;
    content?: string | null;
    citations?: unknown;
    evidence_grade?: string | null;
    suggestions?: unknown;
  };
  const raw = await apiFetch<RawMessage[]>(`/conversations/${conversationId}/messages`, token);
  return raw.map((msg) => {
    let citations = msg.citations as ChatMessage['citations'];
    if (typeof citations === 'string') {
      try {
        citations = JSON.parse(citations);
      } catch {
        citations = undefined;
      }
    }
    return {
      id: msg.id,
      role: msg.role as 'user' | 'assistant',
      content: msg.content ?? '',
      citations,
      evidence_grade: msg.evidence_grade ?? undefined,
      suggestions:
        Array.isArray(msg.suggestions) && msg.suggestions.length > 0
          ? (msg.suggestions as string[])
          : undefined,
      isStreaming: false,
      isError: false,
    };
  });
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export async function fetchMyProfile(token: string): Promise<PhysicianProfile> {
  return apiFetch('/profile/me', token);
}

export async function fetchProfile(userId: string, token: string): Promise<PhysicianProfile> {
  return apiFetch(`/profile/${userId}`, token);
}

export async function completeOnboarding(data: object, token: string): Promise<PhysicianProfile> {
  return apiFetch('/profile/me/onboarding', token, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateProfile(data: object, token: string): Promise<PhysicianProfile> {
  return apiFetch('/profile/me', token, { method: 'PUT', body: JSON.stringify(data) });
}

// ---------------------------------------------------------------------------
// Feed + Posts
// ---------------------------------------------------------------------------

export async function fetchFeed(
  token: string,
  cursor?: string | null,
  filter: 'all' | 'following' = 'all',
  limit = 20,
): Promise<Post[]> {
  const params = new URLSearchParams({ filter, limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  return apiFetch(`/feed?${params}`, token);
}

export async function fetchTrendingPosts(token: string, limit = 20): Promise<Post[]> {
  return apiFetch(`/posts/trending?limit=${limit}`, token);
}

export async function fetchPost(postId: string, token: string): Promise<Post> {
  return apiFetch(`/posts/${postId}`, token);
}

export async function createPost(
  data: {
    content: string;
    post_type: PostType;
    tags: string[];
    specialty_tags: string[];
    is_anonymous: boolean;
  },
  token: string,
): Promise<Post> {
  return apiFetch('/posts', token, { method: 'POST', body: JSON.stringify(data) });
}

export async function deletePost(postId: string, token: string): Promise<void> {
  return apiFetch(`/posts/${postId}`, token, { method: 'DELETE' });
}

export async function togglePostLike(postId: string, token: string): Promise<LikeResponse> {
  return apiFetch(`/posts/${postId}/like`, token, { method: 'POST' });
}

export async function fetchUserPosts(
  userId: string,
  token: string,
  cursor?: string,
): Promise<Post[]> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  return apiFetch(`/users/${userId}/posts?${params}`, token);
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export async function fetchComments(postId: string, token: string): Promise<Comment[]> {
  return apiFetch(`/posts/${postId}/comments`, token);
}

export async function createComment(
  postId: string,
  data: { content: string; parent_comment_id?: string | null; is_anonymous: boolean },
  token: string,
): Promise<Comment> {
  return apiFetch(`/posts/${postId}/comments`, token, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deleteComment(commentId: string, token: string): Promise<void> {
  return apiFetch(`/comments/${commentId}`, token, { method: 'DELETE' });
}

export async function toggleCommentLike(commentId: string, token: string): Promise<LikeResponse> {
  return apiFetch(`/comments/${commentId}/like`, token, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Follows
// ---------------------------------------------------------------------------

export async function followUser(userId: string, token: string): Promise<void> {
  return apiFetch(`/users/${userId}/follow`, token, { method: 'POST' });
}

export async function unfollowUser(userId: string, token: string): Promise<void> {
  return apiFetch(`/users/${userId}/follow`, token, { method: 'DELETE' });
}

export async function fetchFollowers(userId: string, token: string): Promise<DiscoverUser[]> {
  return apiFetch(`/users/${userId}/followers`, token);
}

export async function fetchFollowing(userId: string, token: string): Promise<DiscoverUser[]> {
  return apiFetch(`/users/${userId}/following`, token);
}

// ---------------------------------------------------------------------------
// Discover
// ---------------------------------------------------------------------------

export async function discoverUsers(
  token: string,
  params?: { specialty?: string; country?: string; limit?: number; offset?: number },
): Promise<DiscoverUser[]> {
  const qs = new URLSearchParams();
  if (params?.specialty) qs.set('specialty', params.specialty);
  if (params?.country) qs.set('country', params.country);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  return apiFetch(`/discover/users?${qs}`, token);
}

// ---------------------------------------------------------------------------
// Surveys
// ---------------------------------------------------------------------------

export async function fetchSurveys(token: string): Promise<Survey[]> {
  return apiFetch('/surveys', token);
}

export async function fetchSurvey(surveyId: string, token: string): Promise<Survey> {
  return apiFetch(`/surveys/${surveyId}`, token);
}

export async function createSurvey(data: object, token: string): Promise<Survey> {
  return apiFetch('/surveys', token, { method: 'POST', body: JSON.stringify(data) });
}

export async function updateSurveyStatus(
  surveyId: string,
  status: SurveyStatus,
  token: string,
): Promise<void> {
  return apiFetch(`/surveys/${surveyId}/status`, token, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function submitSurveyResponse(
  surveyId: string,
  answers: SurveyAnswerInput[],
  token: string,
): Promise<{ response_id: string }> {
  return apiFetch(`/surveys/${surveyId}/responses`, token, {
    method: 'POST',
    body: JSON.stringify({ answers }),
  });
}

export async function fetchSurveyResults(surveyId: string, token: string): Promise<SurveyResults> {
  return apiFetch(`/surveys/${surveyId}/results`, token);
}

// ---------------------------------------------------------------------------
// Auth helper — convenience wrapper around supabase.auth.getSession()
// ---------------------------------------------------------------------------

import { supabase } from '@/lib/supabase';

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
