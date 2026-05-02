'use client'

import { useState } from 'react'
import { createComment, toggleCommentLike } from '@/lib/api'
import SpecialtyBadge from '@/components/SpecialtyBadge'
import type { Comment } from '@/types'

function timeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

interface CommentItemProps {
  comment: Comment
  token: string
  onReply: (parentId: string, parentName: string) => void
}

function CommentItem({ comment, token, onReply }: CommentItemProps) {
  const [liked, setLiked] = useState(comment.viewer_liked)
  const [likeCount, setLikeCount] = useState(comment.like_count)

  async function handleLike() {
    const wasLiked = liked
    setLiked(!liked)
    setLikeCount((c) => c + (liked ? -1 : 1))
    try {
      const res = await toggleCommentLike(comment.id, token)
      setLiked(res.liked)
      setLikeCount(res.like_count)
    } catch {
      setLiked(wasLiked)
      setLikeCount(comment.like_count)
    }
  }

  return (
    <div className="flex gap-3">
      <div className="w-7 h-7 rounded-full bg-brand-navy flex-shrink-0 flex items-center justify-center overflow-hidden mt-0.5">
        {comment.author_avatar ? (
          <img src={comment.author_avatar} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="text-xs font-bold text-brand-accent">
            {comment.author_name.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="text-xs font-semibold text-brand-text">{comment.author_name}</span>
          {comment.author_specialty && (
            <SpecialtyBadge specialty={comment.author_specialty} size="xs" />
          )}
          <span className="text-[10px] text-brand-subtle">{timeAgo(comment.created_at)}</span>
        </div>
        <p className="text-sm text-brand-text/90 leading-relaxed">{comment.content}</p>
        <div className="flex items-center gap-4 mt-2">
          <button
            onClick={handleLike}
            className={`flex items-center gap-1 text-[11px] transition-colors ${
              liked ? 'text-brand-pink' : 'text-brand-subtle hover:text-brand-pink'
            }`}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
            {likeCount}
          </button>
          <button
            onClick={() => onReply(comment.id, comment.author_name)}
            className="text-[11px] text-brand-subtle hover:text-brand-text transition-colors"
          >
            Reply
          </button>
        </div>
      </div>
    </div>
  )
}

interface Props {
  postId: string
  comments: Comment[]
  token: string
  onCommentAdded: (comment: Comment) => void
}

export default function CommentThread({ postId, comments, token, onCommentAdded }: Props) {
  const [text, setText] = useState('')
  const [isAnonymous, setIsAnonymous] = useState(false)
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Nest comments: top-level + their replies
  const topLevel = comments.filter((c) => !c.parent_comment_id)
  const replies = (parentId: string) => comments.filter((c) => c.parent_comment_id === parentId)

  async function handleSubmit() {
    if (!text.trim()) return
    setLoading(true)
    setError(null)
    try {
      const comment = await createComment(
        postId,
        { content: text.trim(), parent_comment_id: replyTo?.id ?? null, is_anonymous: isAnonymous },
        token,
      )
      onCommentAdded(comment)
      setText('')
      setReplyTo(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post comment')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold text-brand-text mb-4">
        {comments.length} {comments.length === 1 ? 'Comment' : 'Comments'}
      </h3>

      {/* Comment input */}
      <div className="bg-brand-surface border border-brand-border rounded-xl p-4 mb-6">
        {replyTo && (
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-brand-muted">Replying to {replyTo.name}</span>
            <button onClick={() => setReplyTo(null)} className="text-brand-subtle hover:text-brand-text text-xs">
              Cancel reply
            </button>
          </div>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Share your thoughts or clinical insights…"
          rows={3}
          className="w-full bg-brand-bg border border-brand-border rounded-lg px-3 py-2.5 text-sm text-brand-text placeholder-brand-subtle resize-none outline-none focus:border-brand-accent/45"
        />
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsAnonymous(!isAnonymous)}
              className={`relative w-8 h-4 rounded-full transition-colors ${isAnonymous ? 'bg-brand-accent' : 'bg-brand-border'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${isAnonymous ? 'translate-x-4' : ''}`} />
            </button>
            <span className="text-[11px] text-brand-subtle">Anonymous</span>
          </div>
          <button
            onClick={handleSubmit}
            disabled={loading || !text.trim()}
            className="px-4 py-1.5 text-xs font-semibold text-white bg-brand-accent hover:bg-brand-accent-hover disabled:opacity-40 rounded-lg transition-colors"
          >
            {loading ? 'Posting…' : 'Comment'}
          </button>
        </div>
        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      </div>

      {/* Comment list */}
      <div className="space-y-5">
        {topLevel.map((comment) => (
          <div key={comment.id}>
            <CommentItem
              comment={comment}
              token={token}
              onReply={(id, name) => setReplyTo({ id, name })}
            />
            {/* Replies */}
            {replies(comment.id).length > 0 && (
              <div className="ml-10 mt-3 space-y-3 pl-3 border-l border-brand-border/50">
                {replies(comment.id).map((reply) => (
                  <CommentItem
                    key={reply.id}
                    comment={reply}
                    token={token}
                    onReply={(id, name) => setReplyTo({ id, name })}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
