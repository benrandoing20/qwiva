'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { togglePostLike } from '@/lib/api'
import SpecialtyBadge from '@/components/SpecialtyBadge'
import FollowButton from '@/components/FollowButton'
import type { Post } from '@/types'

const POST_TYPE_LABEL: Record<string, string> = {
  question: 'Question',
  case_discussion: 'Case',
  clinical_pearl: 'Pearl',
  resource: 'Resource',
}

const POST_TYPE_COLOR: Record<string, string> = {
  question: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
  case_discussion: 'bg-violet-500/15 text-violet-400 border-violet-500/25',
  clinical_pearl: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  resource: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
}

function timeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(isoStr).toLocaleDateString()
}

interface Props {
  post: Post
  token: string
  currentUserId?: string
  onUpdate?: (updated: Post) => void
}

export default function PostCard({ post, token, currentUserId, onUpdate }: Props) {
  const [liked, setLiked] = useState(post.viewer_liked)
  const [likeCount, setLikeCount] = useState(post.like_count)
  const [likeLoading, setLikeLoading] = useState(false)

  // Sync local optimistic state when the parent supplies a fresh post
  // (same id, updated fields). Without this, the same post rendered in two
  // lists drifts: liking it in one card leaves the other card's heart stale.
  useEffect(() => {
    setLiked(post.viewer_liked)
    setLikeCount(post.like_count)
  }, [post.id, post.viewer_liked, post.like_count])

  async function handleLike() {
    if (likeLoading) return
    setLikeLoading(true)
    // Optimistic update
    const wasLiked = liked
    setLiked(!liked)
    setLikeCount((c) => c + (liked ? -1 : 1))
    try {
      const result = await togglePostLike(post.id, token)
      setLiked(result.liked)
      setLikeCount(result.like_count)
      onUpdate?.({ ...post, viewer_liked: result.liked, like_count: result.like_count })
    } catch {
      setLiked(wasLiked)
      setLikeCount(post.like_count)
    } finally {
      setLikeLoading(false)
    }
  }

  const isOwnPost = currentUserId === post.author_id
  const typeColor = POST_TYPE_COLOR[post.post_type] ?? 'bg-brand-raised text-brand-muted border-brand-border'
  const typeLabel = POST_TYPE_LABEL[post.post_type] ?? post.post_type

  return (
    <article className="bg-brand-surface border border-brand-border rounded-2xl p-5 hover:border-brand-border/80 transition-colors animate-fadeIn">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-3 min-w-0">
          {/* Avatar */}
          <div className="w-9 h-9 rounded-full bg-brand-navy flex-shrink-0 flex items-center justify-center overflow-hidden">
            {post.author_avatar ? (
              <img src={post.author_avatar} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-sm font-bold text-brand-accent">
                {post.author_name.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          {/* Name + meta */}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-brand-text truncate">
                {post.author_name}
              </span>
              {post.author_verified === 'verified' && (
                <svg className="w-3.5 h-3.5 text-brand-accent flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
              {post.author_specialty && (
                <SpecialtyBadge specialty={post.author_specialty} size="xs" />
              )}
              <span className="text-[11px] text-brand-subtle">{timeAgo(post.created_at)}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-[11px] font-medium border rounded-full px-2 py-0.5 ${typeColor}`}>
            {typeLabel}
          </span>
          {!isOwnPost && !post.is_anonymous && (
            <FollowButton
              userId={post.author_id}
              isFollowing={post.is_following}
              token={token}
              onToggle={(f) => onUpdate?.({ ...post, is_following: f })}
            />
          )}
        </div>
      </div>

      {/* Content */}
      <Link href={`/community/post/${post.id}`}>
        <p className="text-sm text-brand-text leading-relaxed line-clamp-4 hover:text-brand-text/90 cursor-pointer">
          {post.content}
        </p>
      </Link>

      {/* Tags */}
      {post.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {post.tags.map((tag) => (
            <span
              key={tag}
              className="text-[11px] text-brand-muted bg-brand-raised border border-brand-border rounded-full px-2 py-0.5"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* Footer actions */}
      <div className="flex items-center gap-4 mt-4 pt-3 border-t border-brand-border/50">
        <button
          onClick={handleLike}
          disabled={likeLoading}
          className={`flex items-center gap-1.5 text-xs transition-colors ${
            liked ? 'text-brand-pink' : 'text-brand-muted hover:text-brand-pink'
          }`}
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill={liked ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="2"
          >
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
            />
          </svg>
          <span>{likeCount}</span>
        </button>

        <Link
          href={`/community/post/${post.id}`}
          className="flex items-center gap-1.5 text-xs text-brand-muted hover:text-brand-text transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          <span>{post.comment_count}</span>
        </Link>
      </div>
    </article>
  )
}
