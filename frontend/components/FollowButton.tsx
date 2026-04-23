'use client'

import { useState } from 'react'
import { followUser, unfollowUser } from '@/lib/api'

interface Props {
  userId: string
  isFollowing: boolean
  token: string
  onToggle?: (nowFollowing: boolean) => void
}

export default function FollowButton({ userId, isFollowing: initialFollowing, token, onToggle }: Props) {
  const [following, setFollowing] = useState(initialFollowing)
  const [loading, setLoading] = useState(false)

  async function toggle() {
    if (loading) return
    setLoading(true)
    try {
      if (following) {
        await unfollowUser(userId, token)
        setFollowing(false)
        onToggle?.(false)
      } else {
        await followUser(userId, token)
        setFollowing(true)
        onToggle?.(true)
      }
    } catch (err) {
      console.error('Follow toggle failed:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      className={`px-3 py-1 text-xs font-semibold rounded-full border transition-all disabled:opacity-50 ${
        following
          ? 'border-brand-border text-brand-muted hover:text-red-400 hover:border-red-500/30'
          : 'border-brand-accent/40 text-brand-accent hover:bg-brand-accent/10'
      }`}
    >
      {following ? 'Following' : 'Follow'}
    </button>
  )
}
