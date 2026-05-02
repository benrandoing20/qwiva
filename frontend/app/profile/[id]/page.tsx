'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase, getAccessToken } from '@/lib/supabase'
import { fetchProfile, fetchMyProfile, fetchUserPosts } from '@/lib/api'
import Navbar from '@/components/Navbar'
import PostCard from '@/components/PostCard'
import SpecialtyBadge from '@/components/SpecialtyBadge'
import FollowButton from '@/components/FollowButton'
import EditProfilePanel from '@/components/EditProfilePanel'
import type { PhysicianProfile, Post } from '@/types'

export default function ProfilePage() {
  const params = useParams()
  const router = useRouter()
  const idParam = params.id as string

  const [token, setToken] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [profile, setProfile] = useState<PhysicianProfile | null>(null)
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [postsLoading, setPostsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'posts' | 'about'>('posts')
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/auth/login'); return }
      const t = await getAccessToken()
      if (!t) { router.push('/auth/login'); return }
      setToken(t)
      const uid = data.session.user.id
      setCurrentUserId(uid)

      try {
        const resolvedId = idParam === 'me' ? uid : idParam
        const p = resolvedId === uid ? await fetchMyProfile(t) : await fetchProfile(resolvedId, t)
        setProfile(p)
      } catch {
        router.push('/discover')
      } finally {
        setLoading(false)
      }
    })
  }, [idParam, router])

  useEffect(() => {
    if (!token || !profile || activeTab !== 'posts') return
    setPostsLoading(true)
    fetchUserPosts(profile.user_id, token)
      .then(setPosts)
      .catch(console.error)
      .finally(() => setPostsLoading(false))
  }, [token, profile, activeTab])

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-bg">
        <Navbar />
        <div className="max-w-2xl mx-auto px-4 pt-20">
          <div className="animate-pulse mt-6">
            <div className="bg-brand-surface border border-brand-border rounded-2xl p-6">
              <div className="flex gap-4 mb-4">
                <div className="w-16 h-16 rounded-full bg-brand-border" />
                <div className="flex-1">
                  <div className="h-4 bg-brand-border rounded w-1/3 mb-2" />
                  <div className="h-3 bg-brand-border rounded w-1/4" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!profile) return null

  const isOwnProfile = currentUserId === profile.user_id

  return (
    <div className="min-h-screen bg-brand-bg">
      <Navbar />
      <div className="max-w-2xl mx-auto px-4 pt-20 pb-24">
        <Link href="/discover" className="inline-flex items-center gap-1.5 text-sm text-brand-muted hover:text-brand-text transition-colors mb-6">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Discover
        </Link>

        {/* Profile header */}
        <div className="bg-brand-surface border border-brand-border rounded-2xl p-6 mb-6 animate-fadeIn">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-16 h-16 rounded-full bg-brand-navy flex-shrink-0 flex items-center justify-center overflow-hidden">
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xl font-bold text-brand-accent">
                    {profile.display_name.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-bold text-brand-text">{profile.display_name}</h1>
                  {profile.verification_status === 'verified' && (
                    <svg className="w-4 h-4 text-brand-accent" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                </div>
                {profile.specialty && (
                  <div className="mt-1">
                    <SpecialtyBadge specialty={profile.specialty} size="sm" />
                  </div>
                )}
                <p className="text-xs text-brand-muted mt-1">
                  {[profile.institution, profile.city, profile.country].filter(Boolean).join(' · ')}
                </p>
              </div>
            </div>
            <div className="flex-shrink-0 flex flex-col items-end gap-2">
              {isOwnProfile ? (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="text-xs px-3 py-1.5 border border-brand-border rounded-lg text-brand-muted hover:text-brand-text transition-colors"
                >
                  Edit profile
                </button>
              ) : (
                profile.is_following !== null && token && (
                  <FollowButton
                    userId={profile.user_id}
                    isFollowing={!!profile.is_following}
                    token={token}
                    onToggle={(f) => setProfile((p) => p ? { ...p, is_following: f } : p)}
                  />
                )
              )}
            </div>
          </div>

          {profile.bio && (
            <p className="text-sm text-brand-muted mt-4 leading-relaxed">{profile.bio}</p>
          )}

          {/* Stats */}
          <div className="flex gap-6 mt-5 pt-4 border-t border-brand-border/50">
            <div className="text-center">
              <div className="text-lg font-bold text-brand-text">{profile.post_count}</div>
              <div className="text-[11px] text-brand-muted">Posts</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-brand-text">{profile.follower_count}</div>
              <div className="text-[11px] text-brand-muted">Followers</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-brand-text">{profile.following_count}</div>
              <div className="text-[11px] text-brand-muted">Following</div>
            </div>
            {profile.years_experience && (
              <div className="text-center">
                <div className="text-lg font-bold text-brand-text">{profile.years_experience}</div>
                <div className="text-[11px] text-brand-muted">Years exp.</div>
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-brand-surface border border-brand-border rounded-xl p-1 mb-6">
          {(['posts', 'about'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all capitalize ${
                activeTab === t ? 'bg-brand-raised text-brand-text' : 'text-brand-muted hover:text-brand-text'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Posts tab */}
        {activeTab === 'posts' && (
          <div className="space-y-4">
            {postsLoading ? (
              <div className="text-center py-8 text-sm text-brand-muted">Loading posts…</div>
            ) : posts.length === 0 ? (
              <div className="text-center py-8 text-sm text-brand-muted">No posts yet.</div>
            ) : (
              posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  token={token ?? ''}
                  currentUserId={currentUserId ?? undefined}
                  onUpdate={(updated) => setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))}
                />
              ))
            )}
          </div>
        )}

        {/* About tab */}
        {activeTab === 'about' && (
          <div className="bg-brand-surface border border-brand-border rounded-2xl p-6 space-y-4">
            {[
              { label: 'Specialty', value: profile.specialty },
              { label: 'Subspecialty', value: profile.subspecialty },
              { label: 'Institution', value: profile.institution },
              { label: 'Country', value: profile.country },
              { label: 'City', value: profile.city },
              { label: 'Experience', value: profile.years_experience ? `${profile.years_experience} years` : null },
              { label: 'Languages', value: profile.languages.length > 0 ? profile.languages.join(', ') : null },
              { label: 'Verification', value: profile.verification_status },
            ].filter((r) => r.value).map(({ label, value }) => (
              <div key={label} className="flex gap-4">
                <span className="text-xs text-brand-muted w-24 flex-shrink-0 pt-0.5">{label}</span>
                <span className="text-sm text-brand-text">{value}</span>
              </div>
            ))}
            {profile.interests.length > 0 && (
              <div className="flex gap-4">
                <span className="text-xs text-brand-muted w-24 flex-shrink-0 pt-0.5">Interests</span>
                <div className="flex flex-wrap gap-1.5">
                  {profile.interests.map((i) => (
                    <span key={i} className="text-[11px] bg-brand-raised border border-brand-border rounded-full px-2 py-0.5 text-brand-muted">{i}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {isOwnProfile && profile && token && (
        <EditProfilePanel
          open={editing}
          onClose={() => setEditing(false)}
          profile={profile}
          token={token}
          onSaved={(p) => setProfile(p)}
        />
      )}
    </div>
  )
}
