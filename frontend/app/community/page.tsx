'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, getAccessToken } from '@/lib/supabase'
import { fetchFeed, fetchTrendingPosts } from '@/lib/api'
import Navbar from '@/components/Navbar'
import PostCard from '@/components/PostCard'
import PostComposer from '@/components/PostComposer'
import type { Post } from '@/types'

type FeedTab = 'for-you' | 'following' | 'trending'

export default function CommunityPage() {
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [tab, setTab] = useState<FeedTab>('for-you')
  const [composing, setComposing] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/auth/login'); return }
      const t = await getAccessToken()
      if (!t) { router.push('/auth/login'); return }

      // Onboarding gate — redirect before the user can access community features
      const uid = data.session.user.id
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('onboarding_complete')
        .eq('user_id', uid)
        .maybeSingle()
      if (!profile || !profile.onboarding_complete) {
        router.push('/onboarding')
        return
      }

      setToken(t)
      setUserId(uid)
    })
  }, [router])

  const loadFeed = useCallback(async (reset = false, overrideTab?: FeedTab) => {
    if (!token) return
    const activeTab = overrideTab ?? tab
    const nextCursor = reset ? undefined : cursor ?? undefined
    if (!reset && !hasMore) return

    reset ? setLoading(true) : setLoadingMore(true)
    try {
      let newPosts: Post[]
      if (activeTab === 'trending') {
        newPosts = await fetchTrendingPosts(token, 30)
        setPosts(newPosts)
        setHasMore(false)
      } else {
        const filter = activeTab === 'following' ? 'following' : 'all'
        newPosts = await fetchFeed(token, nextCursor, filter, 20)
        if (reset) {
          setPosts(newPosts)
        } else {
          setPosts((prev) => [...prev, ...newPosts])
        }
        if (newPosts.length > 0) {
          setCursor(newPosts[newPosts.length - 1].created_at)
          setHasMore(newPosts.length === 20)
        } else {
          setHasMore(false)
        }
      }
    } catch (err) {
      console.error('Failed to load feed:', err)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [token, tab, cursor, hasMore])

  useEffect(() => {
    if (token) {
      setCursor(null)
      setHasMore(true)
      loadFeed(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, tab])

  // Infinite scroll
  useEffect(() => {
    if (!bottomRef.current) return
    observerRef.current?.disconnect()
    observerRef.current = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && !loadingMore && hasMore) loadFeed(false) },
      { threshold: 0.1 },
    )
    observerRef.current.observe(bottomRef.current)
    return () => observerRef.current?.disconnect()
  }, [loadFeed, loadingMore, hasMore])

  function switchTab(t: FeedTab) {
    if (t === tab) return
    setCursor(null)
    setHasMore(true)
    setTab(t)
  }

  function handleNewPost(post: Post) {
    setComposing(false)
    setPosts((prev) => [post, ...prev])
  }

  function handlePostUpdate(updated: Post) {
    setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
  }

  return (
    <div className="min-h-screen bg-brand-bg">
      <Navbar />
      <div className="max-w-2xl mx-auto px-4 pt-20 pb-24">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-brand-text">Community</h1>
          <button
            onClick={() => setComposing(!composing)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-brand-accent hover:bg-brand-accent-hover rounded-xl transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Post
          </button>
        </div>

        {/* Composer */}
        {composing && token && (
          <div className="mb-6">
            <PostComposer
              token={token}
              onPost={handleNewPost}
              onCancel={() => setComposing(false)}
            />
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 bg-brand-surface border border-brand-border rounded-xl p-1 mb-6">
          {([['for-you', 'For You'], ['following', 'Following'], ['trending', 'Trending']] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => switchTab(value)}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
                tab === value
                  ? 'bg-brand-raised text-brand-text'
                  : 'text-brand-muted hover:text-brand-text'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Feed */}
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-brand-surface border border-brand-border rounded-2xl p-5 animate-pulse">
                <div className="flex gap-3 mb-4">
                  <div className="w-9 h-9 rounded-full bg-brand-border" />
                  <div className="flex-1">
                    <div className="h-3 bg-brand-border rounded w-1/3 mb-2" />
                    <div className="h-2 bg-brand-border rounded w-1/4" />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="h-3 bg-brand-border rounded" />
                  <div className="h-3 bg-brand-border rounded w-4/5" />
                  <div className="h-3 bg-brand-border rounded w-3/5" />
                </div>
              </div>
            ))}
          </div>
        ) : posts.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-brand-muted mb-2">
              {tab === 'following'
                ? 'No posts from people you follow yet.'
                : 'No posts yet — be the first!'}
            </p>
            {tab === 'following' && (
              <button
                onClick={() => switchTab('for-you')}
                className="text-sm text-brand-accent hover:text-brand-accent-hover"
              >
                See all posts →
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                token={token ?? ''}
                currentUserId={userId ?? undefined}
                onUpdate={handlePostUpdate}
              />
            ))}
            {loadingMore && (
              <div className="text-center py-4">
                <span className="text-sm text-brand-muted">Loading…</span>
              </div>
            )}
            <div ref={bottomRef} className="h-4" />
          </div>
        )}
      </div>
    </div>
  )
}
