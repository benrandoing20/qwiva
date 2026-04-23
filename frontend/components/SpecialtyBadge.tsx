const SPECIALTY_COLORS: Record<string, string> = {
  'Pediatrics': 'bg-sky-500/15 text-sky-400 border-sky-500/25',
  'Pediatrics / Child Health': 'bg-sky-500/15 text-sky-400 border-sky-500/25',
  'Obstetrics & Gynecology': 'bg-pink-500/15 text-pink-400 border-pink-500/25',
  'Surgery': 'bg-orange-500/15 text-orange-400 border-orange-500/25',
  'Surgery (General)': 'bg-orange-500/15 text-orange-400 border-orange-500/25',
  'Emergency Medicine': 'bg-red-500/15 text-red-400 border-red-500/25',
  'Infectious Disease': 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
  'Public Health / Community Medicine': 'bg-green-500/15 text-green-400 border-green-500/25',
  'Cardiology': 'bg-rose-500/15 text-rose-400 border-rose-500/25',
  'Neurology': 'bg-violet-500/15 text-violet-400 border-violet-500/25',
  'Psychiatry / Mental Health': 'bg-purple-500/15 text-purple-400 border-purple-500/25',
  'Oncology': 'bg-amber-500/15 text-amber-400 border-amber-500/25',
}

const DEFAULT_COLOR = 'bg-brand-raised text-brand-muted border-brand-border'

interface Props {
  specialty: string
  size?: 'sm' | 'xs'
}

export default function SpecialtyBadge({ specialty, size = 'sm' }: Props) {
  const color = SPECIALTY_COLORS[specialty] ?? DEFAULT_COLOR
  const textSize = size === 'xs' ? 'text-[10px]' : 'text-xs'
  return (
    <span className={`inline-block border rounded-full px-2 py-0.5 font-medium ${textSize} ${color}`}>
      {specialty}
    </span>
  )
}
