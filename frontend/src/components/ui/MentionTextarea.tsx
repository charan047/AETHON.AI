import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { clsx } from 'clsx'
import type { Agent } from '../../types'

type MentionTextareaProps = {
  value: string
  onChange: (value: string) => void
  agents: Agent[]
  placeholder: string
  onMentionSelected?: (agent: Agent) => void
  className?: string
  minHeightClassName?: string
  rows?: number
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void
}

function mentionDisplay(agent: Agent) {
  return agent.persona_name || agent.name
}

function mentionSearchTokens(agent: Agent) {
  return [agent.persona_name || '', agent.name, agent.role, agent.role_slug || '']
    .join(' ')
    .trim()
    .toLowerCase()
}

export function MentionTextarea({
  value,
  onChange,
  agents,
  placeholder,
  onMentionSelected,
  className,
  minHeightClassName = 'min-h-[110px]',
  rows = 4,
  onKeyDown,
}: MentionTextareaProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`
  }, [value])

  const matches = useMemo(() => {
    if (!open) return []
    const normalizedQuery = query.trim().toLowerCase()
    const ranked = agents
      .map(agent => {
        const display = mentionDisplay(agent).toLowerCase()
        const haystack = mentionSearchTokens(agent)
        const startsWith = normalizedQuery ? Number(display.startsWith(normalizedQuery)) : 1
        const includes = normalizedQuery ? Number(haystack.includes(normalizedQuery)) : 1
        return { agent, startsWith, includes }
      })
      .filter(item => item.startsWith || item.includes)
      .sort((a, b) => {
        if (a.startsWith !== b.startsWith) return b.startsWith - a.startsWith
        return mentionDisplay(a.agent).localeCompare(mentionDisplay(b.agent))
      })

    return ranked.slice(0, 6).map(item => item.agent)
  }, [agents, open, query])

  const updateMentionState = (next: string, caret: number | null) => {
    const uptoCaret = next.slice(0, caret ?? next.length)
    const match = uptoCaret.match(/(?:^|\s)@([A-Za-z][A-Za-z\s\-']{0,40})?$/)
    if (!match) {
      setOpen(false)
      setQuery('')
      setActiveIndex(0)
      return
    }
    setQuery((match[1] || '').trim().toLowerCase())
    setOpen(true)
    setActiveIndex(0)
  }

  const handleChange = (next: string) => {
    onChange(next)
    updateMentionState(next, textareaRef.current?.selectionStart ?? null)
  }

  const applyMention = (agent: Agent) => {
    const textarea = textareaRef.current
    const caret = textarea?.selectionStart ?? value.length
    const before = value.slice(0, caret)
    const after = value.slice(caret)
    const next =
      before.replace(/(?:^|\s)@([A-Za-z][A-Za-z\s\-']{0,40})?$/, match => {
        const prefix = match.startsWith(' ') ? ' ' : ''
        return `${prefix}@${mentionDisplay(agent)} `
      }) + after

    onChange(next)
    setOpen(false)
    setQuery('')
    setActiveIndex(0)
    onMentionSelected?.(agent)
    requestAnimationFrame(() => {
      textarea?.focus()
    })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && matches.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex(current => (current + 1) % matches.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex(current => (current - 1 + matches.length) % matches.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        applyMention(matches[activeIndex] || matches[0])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        setQuery('')
        setActiveIndex(0)
        return
      }
    }

    onKeyDown?.(event)
  }

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        rows={rows}
        onChange={event => handleChange(event.target.value)}
        onClick={event => updateMentionState(value, (event.target as HTMLTextAreaElement).selectionStart)}
        onKeyUp={event => updateMentionState(value, (event.target as HTMLTextAreaElement).selectionStart)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={clsx(
          minHeightClassName,
          'w-full rounded-2xl border border-white/[0.08] bg-black/20 px-4 py-3 text-sm text-white outline-none transition focus:border-blue-500/40',
          className,
        )}
      />
      {open && matches.length > 0 && (
        <div className="absolute left-3 top-3 z-20 w-[300px] rounded-2xl border border-white/[0.08] bg-[#0F1520] p-2 shadow-2xl">
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-white/30">
            Mention an agent
          </div>
          <div className="space-y-1">
            {matches.map((agent, index) => (
              <button
                key={agent.id}
                type="button"
                onMouseDown={event => event.preventDefault()}
                onClick={() => applyMention(agent)}
                className={clsx(
                  'flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition',
                  index === activeIndex ? 'bg-blue-500/15 text-white' : 'hover:bg-white/5',
                )}
              >
                <div>
                  <div className="text-sm text-white">{mentionDisplay(agent)}</div>
                  <div className="text-xs text-white/35">{agent.name} · {agent.role}</div>
                </div>
                <span className="text-xs text-blue-300">@</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
