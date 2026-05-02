'use client'

import { useState } from 'react'
import { createPost } from '@/lib/api'
import type { Post, PostType } from '@/types'

const POST_TYPES: { value: PostType; label: string; description: string }[] = [
  { value: 'question', label: 'Question', description: 'Ask peers a clinical question' },
  { value: 'case_discussion', label: 'Case', description: 'Discuss a clinical case' },
  { value: 'clinical_pearl', label: 'Pearl', description: 'Share a clinical tip or insight' },
  { value: 'resource', label: 'Resource', description: 'Share a useful resource or guideline' },
]

const SPECIALTY_OPTIONS = [
  'General Medicine / Internal Medicine',
  'Family Medicine / General Practice',
  'Emergency Medicine',
  'Pediatrics / Child Health',
  'Obstetrics & Gynecology',
  'Surgery (General)',
  'Psychiatry / Mental Health',
  'Radiology / Imaging',
  'Anesthesiology',
  'Cardiology',
  'Neurology',
  'Oncology',
  'Orthopedics',
  'Ophthalmology',
  'ENT (Ear, Nose & Throat)',
  'Dermatology',
  'Infectious Disease',
  'Pulmonology / Respiratory Medicine',
  'Nephrology / Renal Medicine',
  'Gastroenterology',
  'Endocrinology / Diabetes',
  'Rheumatology',
  'Urology',
  'Hematology',
  'Pathology',
  'Public Health / Community Medicine',
  'Nursing',
  'Pharmacy',
  'Dentistry',
  'Clinical Nutrition / Dietetics',
]

interface Props {
  token: string
  onPost: (post: Post) => void
  onCancel: () => void
}

export default function PostComposer({ token, onPost, onCancel }: Props) {
  const [content, setContent] = useState('')
  const [postType, setPostType] = useState<PostType>('question')
  const [specialtyTags, setSpecialtyTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [isAnonymous, setIsAnonymous] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function addTag() {
    const t = tagInput.trim().toLowerCase().replace(/\s+/g, '-')
    if (t && !tags.includes(t)) setTags([...tags, t])
    setTagInput('')
  }

  function removeTag(tag: string) {
    setTags(tags.filter((t) => t !== tag))
  }

  function toggleSpecialty(s: string) {
    setSpecialtyTags((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    )
  }

  async function handleSubmit() {
    if (!content.trim()) return
    setLoading(true)
    setError(null)
    try {
      const post = await createPost(
        { content: content.trim(), post_type: postType, tags, specialty_tags: specialtyTags, is_anonymous: isAnonymous },
        token,
      )
      onPost(post)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-brand-surface border border-brand-border rounded-2xl p-5 animate-fadeIn">
      {/* Post type selector */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {POST_TYPES.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setPostType(value)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-all ${
              postType === value
                ? 'bg-brand-accent/15 text-brand-accent border-brand-accent/40'
                : 'text-brand-muted border-brand-border hover:border-brand-border/80'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content textarea */}
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={
          postType === 'question' ? 'What clinical question do you have for your peers?'
          : postType === 'case_discussion' ? 'Describe the case — demographics, presentation, investigations, dilemma…'
          : postType === 'clinical_pearl' ? 'Share a clinical pearl or insight…'
          : 'Share a useful resource, guideline, or article…'
        }
        rows={5}
        maxLength={5000}
        className="w-full bg-brand-bg border border-brand-border rounded-xl px-4 py-3 text-sm text-brand-text placeholder-brand-subtle resize-none outline-none focus:border-brand-accent/45 focus:ring-1 focus:ring-brand-accent/15 transition-all"
      />
      <div className="flex justify-end mt-1">
        <span className="text-[11px] text-brand-subtle">{content.length}/5000</span>
      </div>

      {/* Specialty tags */}
      <div className="mt-3">
        <p className="text-xs text-brand-muted mb-2">Relevant specialties (optional)</p>
        <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
          {SPECIALTY_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => toggleSpecialty(s)}
              className={`text-[11px] px-2 py-0.5 rounded-full border transition-all ${
                specialtyTags.includes(s)
                  ? 'bg-brand-accent/15 text-brand-accent border-brand-accent/40'
                  : 'text-brand-subtle border-brand-border hover:border-brand-border/80'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Free-form tags */}
      <div className="mt-3">
        <p className="text-xs text-brand-muted mb-2">Tags (optional)</p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag() } }}
            placeholder="malaria, sepsis, peds…"
            className="flex-1 px-3 py-1.5 bg-brand-bg border border-brand-border rounded-lg text-xs text-brand-text placeholder-brand-subtle outline-none focus:border-brand-accent/45"
          />
          <button
            type="button"
            onClick={addTag}
            className="text-xs text-brand-accent hover:text-brand-accent-hover px-2"
          >
            Add
          </button>
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {tags.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 text-[11px] bg-brand-raised border border-brand-border rounded-full px-2 py-0.5 text-brand-muted">
                #{tag}
                <button onClick={() => removeTag(tag)} className="text-brand-subtle hover:text-brand-text">×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Anonymous toggle */}
      <div className="flex items-center gap-2 mt-4">
        <button
          type="button"
          onClick={() => setIsAnonymous(!isAnonymous)}
          className={`relative w-9 h-5 rounded-full transition-colors ${isAnonymous ? 'bg-brand-accent' : 'bg-brand-border'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${isAnonymous ? 'translate-x-4' : ''}`} />
        </button>
        <span className="text-xs text-brand-muted">Post anonymously (shows &quot;Anonymous Physician&quot;)</span>
      </div>

      {error && (
        <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg mt-3">
          {error}
        </p>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-3 mt-4">
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-brand-muted hover:text-brand-text transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading || !content.trim()}
          className="px-5 py-2 text-sm font-semibold text-white bg-brand-accent hover:bg-brand-accent-hover disabled:opacity-40 disabled:cursor-not-allowed rounded-xl transition-colors"
        >
          {loading ? 'Posting…' : 'Post'}
        </button>
      </div>
    </div>
  )
}
