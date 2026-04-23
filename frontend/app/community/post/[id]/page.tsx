'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase, getAccessToken } from '@/lib/supabase'
import { fetchPost, fetchComments, togglePostLike } from '@/lib/api'
import Navbar from '@/components/Navbar'
import CommentThread from '@/components/CommentThread'
import SpecialtyBadge from '@/components/SpecialtyBadge'
import FollowButton from '@/components/FollowButton'
import type { Post, Comment } from '@/types'

const POST_TYPE_LABEL: Record<string, string> = {
  question: 'Question',
  case_discussion: 'Case Discussion',
  clinical_pearl: 'Clinical Pearl',
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
  return `${Math.floor(hrs / 24)}d ago`
}

export default function PostDetailPage() {
  const params = useParams()
  const router = useRouter()
  const postId = params.id as string

  const [token, setToken] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [post, setPost] = useState<Post | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [liked, setLiked] = useState(false)
  const [likeCount, setLikeCount] = useState(0)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/auth/login'); return }
      const t = await getAccessToken()
      if (!t) { router.push('/auth/login'); return }
      setToken(t)
      setUserId(data.session.user.id)
      try {
        const [p, c] = await Promise.all([fetchPost(postId, t), fetchComments(postId, t)])
        setPost(p)
        setLiked(p.viewer_liked)
        setLikeCount(p.like_count)
        setComments(c)
      } catch {
        router.push('/community')
      } finally {
        setLoading(false)
      }
    })
  }, [postId, router])

  async function handleLike() {
    if (!token || !post) return
    const wasLiked = liked
    setLiked(!liked)
    setLikeCount((c) => c + (liked ? -1 : 1))
    try {
      const res = await togglePostLike(post.id, token)
      setLiked(res.liked)
      setLikeCount(res.like_count)
    } catch {
      setLiked(wasLiked)
      setLikeCount(post.like_count)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-bg">
        <Navbar />
        <div className="max-w-2xl mx-auto px-4 pt-20">
          <div className="animate-pulse space-y-4 mt-6">
            <div className="h-4 bg-brand-border rounded w-1/4" />
            <div className="bg-brand-surface border border-brand-border rounded-2xl p-6">
              <div className="flex gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-brand-border" />
                <div className="flex-1">
                  <div className="h-3 bg-brand-border rounded w-1/3 mb-2" />
                  <div className="h-2 bg-brand-border rounded w-1/4" />
                </div>
              </div>
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-3 bg-brand-border rounded" />)}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!post) return null

  const typeColor = POST_TYPE_COLOR[post.post_type] ?? 'bg-brand-raised text-brand-muted border-brand-border'
  const isOwnPost = userId === post.author_id

  return (
    <div className="min-h-screen bg-brand-bg">
      <Navbar />
      <div className="max-w-2xl mx-auto px-4 pt-20 pb-24">
        {/* Back */}
        <Link href="/community" className="inline-flex items-center gap-1.5 text-sm text-brand-muted hover:text-brand-text transition-colors mb-6">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Community
        </Link>

        {/* Post */}
        <article className="bg-brand-surface border border-brand-border rounded-2xl p-6 mb-6 animate-fadeIn">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-10 h-10 rounded-full bg-brand-navy flex-shrink-0 flex items-center justify-center overflow-hidden">
                {post.author_avatar ? (
                  <img src={post.author_avatar} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-sm font-bold text-brand-accent">
                    {post.author_name.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="min-w-0">
                {!post.is_anonymous ? (
                  <Link href={`/profile/${post.author_id}`} className="text-sm font-semibold text-brand-text hover:text-brand-accent transition-colors">
                    {post.author_name}
                  </Link>
                ) : (
                  <span className="text-sm font-semibold text-brand-text">{post.author_name}</span>
                )}
                <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                  {post.author_specialty && <SpecialtyBadge specialty={post.author_specialty} size="xs" />}
                  <span className="text-[11px] text-brand-subtle">{timeAgo(post.created_at)}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className={`text-xs font-medium border rounded-full px-2 py-0.5 ${typeColor}`}>
                {POST_TYPE_LABEL[post.post_type] ?? post.post_type}
              </span>
              {!isOwnPost && !post.is_anonymous && token && (
                <FollowButton
                  userId={post.author_id}
                  isFollowing={post.is_following}
                  token={token}
                  onToggle={(f) => setPost((p) => p ? { ...p, is_following: f } : p)}
                />
              )}
            </div>
          </div>

          <p className="text-sm text-brand-text leading-relaxed whitespace-pre-wrap">{post.content}</p>

          {post.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-4">
              {post.tags.map((tag) => (
                <span key={tag} className="text-[11px] text-brand-muted bg-brand-raised border border-brand-border rounded-full px-2 py-0.5">
                  #{tag}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-4 mt-5 pt-4 border-t border-brand-border/50">
            <button
              onClick={handleLike}
              className={`flex items-center gap-1.5 text-xs transition-colors ${
                liked ? 'text-brand-pink' : 'text-brand-muted hover:text-brand-pink'
              }`}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
              <span>{likeCount} {likeCount === 1 ? 'like' : 'likes'}</span>
            </button>
            <span className="text-xs text-brand-subtle">
              {post.comment_count} {post.comment_count === 1 ? 'comment' : 'comments'}
            </span>
            <span className="text-xs text-brand-subtle">
              {post.view_count} views
            </span>
          </div>
        </article>

        {/* Comments */}
        {token && (
          <div className="bg-brand-surface border border-brand-border rounded-2xl p-6">
            <CommentThread
              postId={post.id}
              comments={comments}
              token={token}
              onCommentAdded={(c) => setComments((prev) => [...prev, c])}
            />
          </div>
        )}
      </div>
    </div>
  )
}
