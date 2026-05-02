'use client'

import { FormEvent, useEffect, useState } from 'react'
import { updateProfile } from '@/lib/api'
import type { PhysicianProfile } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
  profile: PhysicianProfile
  token: string
  onSaved: (profile: PhysicianProfile) => void
}

type FormState = {
  display_name: string
  first_name: string
  last_name: string
  bio: string
  phone: string
  country: string
  city: string
  institution: string
  years_experience: string
  avatar_url: string
  specialties: string
  languages: string
  interests: string
}

function toForm(p: PhysicianProfile): FormState {
  return {
    display_name: p.display_name ?? '',
    first_name: p.first_name ?? '',
    last_name: p.last_name ?? '',
    bio: p.bio ?? '',
    phone: p.phone ?? '',
    country: p.country ?? '',
    city: p.city ?? '',
    institution: p.institution ?? '',
    years_experience: p.years_experience != null ? String(p.years_experience) : '',
    avatar_url: p.avatar_url ?? '',
    specialties: (p.specialties ?? []).join(', '),
    languages: (p.languages ?? []).join(', '),
    interests: (p.interests ?? []).join(', '),
  }
}

function splitList(value: string): string[] {
  return value.split(',').map((s) => s.trim()).filter(Boolean)
}

export default function EditProfilePanel({ open, onClose, profile, token, onSaved }: Props) {
  const [form, setForm] = useState<FormState>(() => toForm(profile))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) { setForm(toForm(profile)); setError(null) }
  }, [open, profile])

  // Block body scroll while open
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  if (!open) return null

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const years = form.years_experience.trim()
    const payload: Record<string, unknown> = {
      display_name: form.display_name.trim() || undefined,
      first_name: form.first_name.trim() || undefined,
      last_name: form.last_name.trim() || undefined,
      bio: form.bio.trim() || undefined,
      phone: form.phone.trim() || undefined,
      country: form.country.trim() || undefined,
      city: form.city.trim() || undefined,
      institution: form.institution.trim() || undefined,
      avatar_url: form.avatar_url.trim() || undefined,
      years_experience: years ? Number(years) : undefined,
      specialties: splitList(form.specialties),
      languages: splitList(form.languages),
      interests: splitList(form.interests),
    }
    // Strip undefined so we don't blank out backend-untouched fields
    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k])
    try {
      const updated = await updateProfile(payload, token)
      onSaved(updated)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex justify-end"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md h-full bg-brand-bg border-l border-brand-border overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-brand-bg border-b border-brand-border px-5 py-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-brand-text">Edit profile</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-brand-muted hover:text-brand-text transition-colors"
          >
            Close
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-5 space-y-4">
          <Field label="Display name">
            <Input value={form.display_name} onChange={(v) => update('display_name', v)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name">
              <Input value={form.first_name} onChange={(v) => update('first_name', v)} />
            </Field>
            <Field label="Last name">
              <Input value={form.last_name} onChange={(v) => update('last_name', v)} />
            </Field>
          </div>
          <Field label="Bio">
            <textarea
              value={form.bio}
              onChange={(e) => update('bio', e.target.value)}
              rows={3}
              className="w-full px-3 py-2 bg-brand-surface border border-brand-border rounded-lg text-sm text-brand-text placeholder-brand-subtle outline-none focus:border-brand-accent/45 transition-colors resize-none"
            />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={(v) => update('phone', v)} placeholder="+254712548901" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Country">
              <Input value={form.country} onChange={(v) => update('country', v)} />
            </Field>
            <Field label="City">
              <Input value={form.city} onChange={(v) => update('city', v)} />
            </Field>
          </div>
          <Field label="Institution">
            <Input value={form.institution} onChange={(v) => update('institution', v)} placeholder="Hospital, clinic, or university" />
          </Field>
          <Field label="Years of experience">
            <Input
              value={form.years_experience}
              onChange={(v) => update('years_experience', v.replace(/[^\d]/g, ''))}
              placeholder="e.g. 5"
              inputMode="numeric"
            />
          </Field>
          <Field label="Specialties" hint="Comma-separated">
            <Input value={form.specialties} onChange={(v) => update('specialties', v)} placeholder="Internal Medicine, Paediatrics" />
          </Field>
          <Field label="Languages" hint="Comma-separated">
            <Input value={form.languages} onChange={(v) => update('languages', v)} placeholder="English, Swahili" />
          </Field>
          <Field label="Interests" hint="Comma-separated">
            <Input value={form.interests} onChange={(v) => update('interests', v)} placeholder="Sepsis, AMR, EM triage" />
          </Field>
          <Field label="Avatar URL">
            <Input value={form.avatar_url} onChange={(v) => update('avatar_url', v)} placeholder="https://…" />
          </Field>

          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}

          <div className="sticky bottom-0 -mx-5 px-5 py-3 bg-brand-bg border-t border-brand-border flex gap-3 mt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 text-sm text-brand-muted border border-brand-border rounded-lg hover:text-brand-text transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 text-sm font-semibold text-white bg-brand-accent hover:bg-brand-accent-hover disabled:opacity-40 rounded-lg transition-colors"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-brand-muted mb-1.5 uppercase tracking-wide">
        {label}
        {hint && <span className="ml-2 text-[10px] text-brand-subtle normal-case tracking-normal">{hint}</span>}
      </label>
      {children}
    </div>
  )
}

function Input({
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  inputMode?: 'numeric' | 'text' | 'tel'
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      inputMode={inputMode}
      className="w-full px-3 py-2 bg-brand-surface border border-brand-border rounded-lg text-sm text-brand-text placeholder-brand-subtle outline-none focus:border-brand-accent/45 transition-colors"
    />
  )
}
