'use client'

import type { Conversation } from '@/types'

interface Props {
  conversations: Conversation[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  isLoading: boolean
  isOpen: boolean
  onClose: () => void
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function SkeletonItem() {
  return (
    <div className="px-3 py-2.5 rounded-xl animate-pulse">
      <div className="h-3 bg-brand-border rounded w-4/5 mb-1.5" />
      <div className="h-2.5 bg-brand-raised rounded w-1/3" />
    </div>
  )
}

export default function ConversationSidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  isLoading,
  isOpen,
  onClose,
}: Props) {
  return (
    <>
      {/* Mobile backdrop — tap outside to close */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={onClose}
        />
      )}

      <aside className={`flex flex-col w-[260px] flex-shrink-0 bg-brand-bg overflow-hidden fixed top-14 bottom-0 left-0 z-40 transition-transform duration-300 ease-in-out md:static md:top-auto md:bottom-auto md:z-auto md:h-full md:translate-x-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      {/* New conversation button */}
      <div className="p-3">
        <button
          onClick={onNew}
          className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-xl bg-brand-accent hover:bg-brand-accent-hover text-white text-sm font-medium transition-colors shadow-[0_0_24px_-6px_rgba(168,85,247,0.55)]"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New conversation
        </button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto py-2 px-2">
        {isLoading ? (
          <div className="space-y-1">
            {[...Array(5)].map((_, i) => (
              <SkeletonItem key={i} />
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <p className="text-xs text-brand-subtle text-center mt-6 px-4">
            No conversations yet
          </p>
        ) : (
          <ul className="space-y-0.5">
            {conversations.map((conv) => {
              const isActive = conv.id === activeId
              return (
                <li key={conv.id} className="group relative animate-fadeIn">
                  <button
                    onClick={() => !isActive && onSelect(conv.id)}
                    disabled={isActive}
                    className={`w-full text-left px-3 py-2.5 pr-8 rounded-xl transition-colors ${
                      isActive
                        ? 'bg-brand-raised text-brand-text cursor-default'
                        : 'text-brand-muted hover:bg-brand-surface/80 hover:text-brand-text'
                    }`}
                  >
                    <p className="text-sm font-medium truncate leading-snug">
                      {conv.title ?? 'New conversation'}
                    </p>
                    <p className="text-[11px] text-brand-subtle mt-0.5 group-hover:text-brand-muted transition-colors">
                      {relativeTime(conv.updated_at)}
                    </p>
                  </button>

                  {/* Delete button — only visible on hover */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(conv.id)
                    }}
                    title="Delete conversation"
                    className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-red-500/20 text-brand-subtle hover:text-red-400"
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                      <path d="M10 11v6M14 11v6" />
                      <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                    </svg>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
    </>
  )
}
