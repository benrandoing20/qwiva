'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase, getAccessToken } from '@/lib/supabase'
import { fetchSurveys, fetchMyProfile } from '@/lib/api'
import Navbar from '@/components/Navbar'
import type { Survey, PhysicianProfile } from '@/types'

function SurveyCard({ survey }: { survey: Survey }) {
  const isActive = survey.status === 'active'
  const isDraft = survey.status === 'draft'
  const isClosed = survey.status === 'closed'

  return (
    <div className="bg-brand-surface border border-brand-border rounded-2xl p-5 flex flex-col gap-3 animate-fadeIn">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {isDraft && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-brand-raised text-brand-muted border border-brand-border">
                Draft
              </span>
            )}
            {isClosed && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-brand-raised text-brand-muted border border-brand-border">
                Closed
              </span>
            )}
            {survey.specialty_tags.map((tag) => (
              <span
                key={tag}
                className="text-xs px-2 py-0.5 rounded-full bg-brand-navy/20 text-brand-accent border border-brand-accent/20"
              >
                {tag}
              </span>
            ))}
          </div>
          <h2 className="text-base font-semibold text-brand-text">{survey.title}</h2>
          {survey.description && (
            <p className="text-sm text-brand-muted mt-1 line-clamp-2">{survey.description}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-brand-subtle">
        {survey.estimated_minutes && (
          <span>{survey.estimated_minutes} min</span>
        )}
        <span>{survey.response_count} {survey.response_count === 1 ? 'response' : 'responses'}</span>
      </div>

      <div className="flex items-center justify-end">
        {survey.has_responded ? (
          <span className="text-xs px-3 py-1.5 rounded-lg bg-brand-raised text-brand-muted">
            Responded
          </span>
        ) : isActive ? (
          <Link
            href={`/surveys/${survey.id}`}
            className="text-sm px-4 py-2 rounded-xl bg-brand-accent text-white font-medium hover:opacity-90 transition-opacity"
          >
            Take Survey
          </Link>
        ) : (
          <span className="text-xs px-3 py-1.5 rounded-lg bg-brand-raised text-brand-muted">
            {isDraft ? 'Draft' : 'Closed'}
          </span>
        )}
      </div>
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="bg-brand-surface border border-brand-border rounded-2xl p-5 animate-pulse">
      <div className="h-4 bg-brand-raised rounded w-1/3 mb-3" />
      <div className="h-5 bg-brand-raised rounded w-2/3 mb-2" />
      <div className="h-4 bg-brand-raised rounded w-full mb-4" />
      <div className="flex justify-end">
        <div className="h-8 bg-brand-raised rounded-xl w-28" />
      </div>
    </div>
  )
}

export default function SurveysPage() {
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [profile, setProfile] = useState<PhysicianProfile | null>(null)
  const [surveys, setSurveys] = useState<Survey[]>([])
  const [loading, setLoading] = useState(true)

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
    Promise.all([fetchSurveys(token), fetchMyProfile(token)])
      .then(([surveyList, p]) => {
        setSurveys(surveyList)
        setProfile(p)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [token])

  const isAdmin = profile?.role === 'admin'

  const activeSurveys = surveys.filter((s) => s.status === 'active')
  const myDrafts = surveys.filter((s) => s.status === 'draft')
  const closedSurveys = surveys.filter((s) => s.status === 'closed')

  return (
    <div className="min-h-screen bg-brand-bg">
      <Navbar />
      <div className="max-w-2xl mx-auto px-4 pt-20 pb-24">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-brand-text">Surveys</h1>
          {isAdmin && (
            <Link
              href="/surveys/create"
              className="text-sm px-4 py-2 rounded-xl bg-brand-accent text-white font-medium hover:opacity-90 transition-opacity"
            >
              + Create Survey
            </Link>
          )}
        </div>

        {loading ? (
          <div className="space-y-4">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : (
          <div className="space-y-8">
            {activeSurveys.length > 0 && (
              <section>
                <div className="space-y-4">
                  {activeSurveys.map((s) => <SurveyCard key={s.id} survey={s} />)}
                </div>
              </section>
            )}

            {isAdmin && myDrafts.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-brand-muted uppercase tracking-wide mb-3">
                  My Drafts
                </h2>
                <div className="space-y-4">
                  {myDrafts.map((s) => <SurveyCard key={s.id} survey={s} />)}
                </div>
              </section>
            )}

            {isAdmin && closedSurveys.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-brand-muted uppercase tracking-wide mb-3">
                  Closed
                </h2>
                <div className="space-y-4">
                  {closedSurveys.map((s) => <SurveyCard key={s.id} survey={s} />)}
                </div>
              </section>
            )}

            {surveys.length === 0 && (
              <div className="text-center py-16 text-brand-muted">
                <p className="text-base font-medium mb-1">No surveys available</p>
                <p className="text-sm">Check back soon for new surveys.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
