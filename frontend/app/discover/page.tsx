'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, getAccessToken } from '@/lib/supabase'
import { fetchFeed } from '@/lib/api'
import Navbar from '@/components/Navbar'
import PostCard from '@/components/PostCard'
import PostComposer from '@/components/PostComposer'
import type { Post } from '@/types'

const SPECIALTIES = [
  'General Medicine / Internal Medicine',
  'Family Medicine / General Practice',
  'Emergency Medicine',
  'Pediatrics / Child Health',
  'Obstetrics & Gynecology',
  'Surgery (General)',
  'Psychiatry / Mental Health',
  'Cardiology',
  'Neurology',
  'Oncology',
  'Infectious Disease',
  'Public Health / Community Medicine',
]

// Fixed-width card so PostCard fits inside a horizontal scroll without distortion.
const CARD_WIDTH_CLASS = 'w-[340px] flex-shrink-0 snap-start'

interface HScrollProps {
  title: string
  emptyText: string
  loading: boolean
  posts: Post[]
  token: string
  currentUserId?: string
  onUpdate: (updated: Post) => void
  rightSlot?: React.ReactNode
}

function HScrollSection({
  title, emptyText, loading, posts, token, currentUserId, onUpdate, rightSlot,
}: HScrollProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  function nudge(direction: 1 | -1) {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: direction * (el.clientWidth * 0.85), behavior: 'smooth' })
  }

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-base font-semibold text-brand-text">{title}</h2>
        <div className="flex items-center gap-2">
          {rightSlot}
          {!loading && posts.length > 0 && (
            <div className="hidden md:flex gap-1">
              <button
                onClick={() => nudge(-1)}
                aria-label="Scroll left"
                className="p-1.5 text-brand-muted hover:text-brand-text rounded-md hover:bg-brand-raised transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
              <button
                onClick={() => nudge(1)}
                aria-label="Scroll right"
                className="p-1.5 text-brand-muted hover:text-brand-text rounded-md hover:bg-brand-raised transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex gap-4 overflow-hidden">
          {[1, 2, 3].map((i) => (
            <div key={i} className={`${CARD_WIDTH_CLASS} bg-brand-surface border border-brand-border rounded-2xl p-5 animate-pulse`}>
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
        <div className="bg-brand-surface border border-brand-border rounded-2xl p-6 text-center text-sm text-brand-muted">
          {emptyText}
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto snap-x snap-mandatory scrollbar-thin pb-2 -mx-4 px-4"
        >
          {posts.map((post) => (
            <div key={post.id} className={CARD_WIDTH_CLASS}>
              <PostCard
                post={post}
                token={token}
                currentUserId={currentUserId}
                onUpdate={onUpdate}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default function DiscoverPage() {
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [followingPosts, setFollowingPosts] = useState<Post[]>([])
  const [allPosts, setAllPosts] = useState<Post[]>([])
  const [loadingFollowing, setLoadingFollowing] = useState(true)
  const [loadingAll, setLoadingAll] = useState(true)
  const [selectedSpecialty, setSelectedSpecialty] = useState<string>(SPECIALTIES[0])
  const [composing, setComposing] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/auth/login'); return }
      const t = await getAccessToken()
      if (!t) { router.push('/auth/login'); return }

      const uid = data.session.user.id
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('onboarding_complete, specialty')
        .eq('user_id', uid)
        .maybeSingle()
      if (!profile || !profile.onboarding_complete) {
        router.push('/onboarding')
        return
      }

      // Default the specialty section to the user's own specialty when it's
      // one we list — otherwise keep the alphabetical-first default.
      if (profile.specialty && SPECIALTIES.includes(profile.specialty)) {
        setSelectedSpecialty(profile.specialty)
      }

      setToken(t)
      setUserId(uid)
    })
  }, [router])

  // Load both feeds in parallel once we have a token.
  useEffect(() => {
    if (!token) return
    setLoadingFollowing(true)
    setLoadingAll(true)
    fetchFeed(token, null, 'following', 30)
      .then(setFollowingPosts)
      .catch(console.error)
      .finally(() => setLoadingFollowing(false))
    // Pull a larger batch so the specialty buckets aren't sparse — we filter
    // client-side until a /feed?specialty= endpoint exists.
    fetchFeed(token, null, 'all', 50)
      .then(setAllPosts)
      .catch(console.error)
      .finally(() => setLoadingAll(false))
  }, [token])

  const specialtyPosts = useMemo(
    () => allPosts.filter((p) => p.specialty_tags.includes(selectedSpecialty)),
    [allPosts, selectedSpecialty],
  )

  const handlePostUpdate = useCallback((updated: Post) => {
    const merge = (list: Post[]) => list.map((p) => (p.id === updated.id ? updated : p))
    setFollowingPosts(merge)
    setAllPosts(merge)
  }, [])

  const handleNewPost = useCallback((post: Post) => {
    setComposing(false)
    setAllPosts((prev) => [post, ...prev])
    // Send the author straight to their new post. Otherwise it can vanish
    // from the visible rows (Following excludes self-posts; Browse-by-
    // specialty only shows posts tagged with the currently-selected
    // specialty), leaving the composer to collapse onto an empty view.
    router.push(`/community/post/${post.id}`)
  }, [router])

  return (
    <div className="min-h-screen bg-brand-bg">
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 pt-20 pb-24">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-brand-text">Discover</h1>
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
          <div className="mb-8 max-w-2xl">
            <PostComposer
              token={token}
              onPost={handleNewPost}
              onCancel={() => setComposing(false)}
            />
          </div>
        )}

        {/* Following */}
        <HScrollSection
          title="From people you follow"
          emptyText="Follow physicians to see their posts here."
          loading={loadingFollowing}
          posts={followingPosts}
          token={token ?? ''}
          currentUserId={userId ?? undefined}
          onUpdate={handlePostUpdate}
        />

        {/* By specialty */}
        <HScrollSection
          title="Browse by specialty"
          emptyText={`No recent posts tagged ${selectedSpecialty}.`}
          loading={loadingAll}
          posts={specialtyPosts}
          token={token ?? ''}
          currentUserId={userId ?? undefined}
          onUpdate={handlePostUpdate}
          rightSlot={
            <select
              value={selectedSpecialty}
              onChange={(e) => setSelectedSpecialty(e.target.value)}
              className="px-3 py-1.5 bg-brand-surface border border-brand-border rounded-lg text-sm text-brand-text outline-none focus:border-brand-accent/45 transition-all"
            >
              {SPECIALTIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          }
        />
      </div>
    </div>
  )
}
