'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase, getAccessToken } from '@/lib/supabase'
import { discoverUsers } from '@/lib/api'
import Navbar from '@/components/Navbar'
import SpecialtyBadge from '@/components/SpecialtyBadge'
import FollowButton from '@/components/FollowButton'
import type { DiscoverUser } from '@/types'

const SPECIALTIES = [
  '', // "All specialties"
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

const COUNTRIES = [
  '', // "All countries"
  'Kenya', 'Uganda', 'Tanzania', 'Rwanda', 'Ethiopia', 'Nigeria', 'Ghana',
  'South Africa', 'Zambia', 'Zimbabwe', 'Mozambique', 'Malawi', 'Cameroon',
  'Mexico', 'Brazil', 'Colombia', 'Peru', 'Argentina', 'Chile',
]

function PhysicianCard({ user, token }: { user: DiscoverUser; token: string }) {
  return (
    <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 flex items-start gap-3 animate-fadeIn">
      <div className="w-10 h-10 rounded-full bg-brand-navy flex-shrink-0 flex items-center justify-center overflow-hidden">
        {user.avatar_url ? (
          <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="text-sm font-bold text-brand-accent">
            {user.display_name.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <Link
            href={`/profile/${user.user_id}`}
            className="text-sm font-semibold text-brand-text hover:text-brand-accent transition-colors truncate"
          >
            {user.display_name}
          </Link>
          <FollowButton
            userId={user.user_id}
            isFollowing={user.is_following}
            token={token}
          />
        </div>
        {user.specialty && (
          <div className="mt-1">
            <SpecialtyBadge specialty={user.specialty} size="xs" />
          </div>
        )}
        <p className="text-[11px] text-brand-muted mt-1">
          {[user.institution, user.country].filter(Boolean).join(' · ')}
        </p>
        {user.bio && (
          <p className="text-xs text-brand-subtle mt-1.5 line-clamp-2">{user.bio}</p>
        )}
        <div className="flex gap-3 mt-2 text-[11px] text-brand-subtle">
          <span>{user.follower_count} followers</span>
          <span>{user.post_count} posts</span>
        </div>
      </div>
    </div>
  )
}

export default function DiscoverPage() {
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [users, setUsers] = useState<DiscoverUser[]>([])
  const [loading, setLoading] = useState(true)
  const [specialty, setSpecialty] = useState('')
  const [country, setCountry] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.push('/auth/login'); return }
      const t = await getAccessToken()
      if (!t) { router.push('/auth/login'); return }
      setToken(t)
    })
  }, [router])

  useEffect(() => {
    if (!token) return
    setLoading(true)
    discoverUsers(token, {
      specialty: specialty || undefined,
      country: country || undefined,
      limit: 50,
    })
      .then(setUsers)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [token, specialty, country])

  const filtered = search
    ? users.filter(
        (u) =>
          u.display_name.toLowerCase().includes(search.toLowerCase()) ||
          (u.specialty ?? '').toLowerCase().includes(search.toLowerCase()) ||
          (u.institution ?? '').toLowerCase().includes(search.toLowerCase()),
      )
    : users

  return (
    <div className="min-h-screen bg-brand-bg">
      <Navbar />
      <div className="max-w-2xl mx-auto px-4 pt-20 pb-24">
        <h1 className="text-xl font-bold text-brand-text mb-6">Discover Physicians</h1>

        {/* Search + Filters */}
        <div className="space-y-3 mb-6">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, specialty, or institution…"
            className="w-full px-4 py-2.5 bg-brand-surface border border-brand-border rounded-xl text-sm text-brand-text placeholder-brand-subtle outline-none focus:border-brand-accent/45 transition-all"
          />
          <div className="flex gap-3">
            <select
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              className="flex-1 px-3 py-2 bg-brand-surface border border-brand-border rounded-lg text-sm text-brand-text outline-none focus:border-brand-accent/45 transition-all"
            >
              <option value="">All specialties</option>
              {SPECIALTIES.filter(Boolean).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="flex-1 px-3 py-2 bg-brand-surface border border-brand-border rounded-lg text-sm text-brand-text outline-none focus:border-brand-accent/45 transition-all"
            >
              <option value="">All countries</option>
              {COUNTRIES.filter(Boolean).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* Results */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-brand-surface border border-brand-border rounded-2xl p-4 animate-pulse">
                <div className="flex gap-3">
                  <div className="w-10 h-10 rounded-full bg-brand-border" />
                  <div className="flex-1">
                    <div className="h-3 bg-brand-border rounded w-1/3 mb-2" />
                    <div className="h-2 bg-brand-border rounded w-1/4" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-sm text-brand-muted">
            No physicians found. Try adjusting the filters.
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-brand-muted">{filtered.length} physician{filtered.length !== 1 ? 's' : ''}</p>
            {filtered.map((user) => (
              <PhysicianCard key={user.user_id} user={user} token={token ?? ''} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
