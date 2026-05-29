import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle,
  Bell,
  CheckCheck,
  FileText,
  MessageSquare,
  X,
  Zap,
} from 'lucide-react'

import { notificationsApi } from '../api/client'
import { useAnchoredFloating } from '../hooks/useAnchoredFloating'
import { useWsEvent } from '../hooks/useWsEvent'
import type { InAppNotificationRecord } from '../types'

const NOTIF_ICONS: Record<string, typeof Bell> = {
  approval_request: AlertCircle,
  execution_pending_review: FileText,
  file_ready: FileText,
  cto_update: Zap,
  message: MessageSquare,
  default: Bell,
}

const NOTIF_COLORS: Record<string, string> = {
  approval_request: 'text-red-400 bg-red-500/10',
  execution_pending_review: 'text-amber-400 bg-amber-500/10',
  file_ready: 'text-indigo-400 bg-indigo-500/10',
  cto_update: 'text-indigo-400 bg-indigo-500/10',
  message: 'text-blue-400 bg-blue-500/10',
  default: 'text-[var(--t3)] bg-white/[0.06]',
}

function formatRelative(isoString?: string | null): string {
  if (!isoString) return ''
  const date = new Date(isoString)
  const diff = Math.floor((Date.now() - date.getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return date.toLocaleDateString()
}

function notificationTarget(actionUrl?: string | null) {
  if (!actionUrl) return null
  if (actionUrl === '/agency-chat') return '/company-chat'
  return actionUrl
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const panelStyle = useAnchoredFloating({
    open,
    anchorRef: triggerRef,
    panelRef,
    vertical: 'above',
    horizontal: 'start',
    offset: 12,
    preferOutsideSidebar: true,
  })

  const { data: countData } = useQuery({
    queryKey: ['notif-count'],
    queryFn: notificationsApi.unreadCount,
    refetchInterval: 30_000,
  })

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list({ limit: 30 }),
    enabled: open,
  })

  const markAllReadMut = useMutation({
    mutationFn: notificationsApi.markAllRead,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notif-count'] })
      void qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  const dismissMut = useMutation({
    mutationFn: notificationsApi.dismiss,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] })
      void qc.invalidateQueries({ queryKey: ['notif-count'] })
    },
  })

  useEffect(() => {
    if (open && (countData?.count ?? 0) > 0 && !markAllReadMut.isPending) {
      markAllReadMut.mutate()
    }
  }, [open, countData?.count, markAllReadMut])

  useWsEvent('in_app_notification', () => {
    void qc.invalidateQueries({ queryKey: ['notif-count'] })
    if (open) {
      void qc.invalidateQueries({ queryKey: ['notifications'] })
    }
  })

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        setOpen(false)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  const unread = countData?.count ?? 0

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        className="btn-icon relative"
        aria-label="Notifications"
        onClick={() => setOpen(value => !value)}
        data-testid="notification-center-trigger"
      >
        <Bell size={16} />
        <AnimatePresence>
          {unread > 0 ? (
            <motion.span
              key="badge"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 font-mono text-[9px] font-bold text-white"
            >
              {unread > 99 ? '99+' : unread}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </button>

      {open && typeof document !== 'undefined'
        ? createPortal(
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.15 }}
            data-testid="notification-center-panel"
            className="notification-popover z-[90] w-[min(360px,calc(100vw-2rem))]"
            style={panelStyle}
          >
            <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-4 py-3">
              <p className="text-sm font-semibold text-[var(--t1)]">Notifications</p>
              {unread > 0 ? (
                <button
                  onClick={() => markAllReadMut.mutate()}
                  className="flex items-center gap-1.5 text-xs text-[var(--t3)] transition-colors hover:text-[var(--t2)]"
                >
                  <CheckCheck size={12} />
                  Mark all read
                </button>
              ) : null}
            </div>

            <div className="max-h-[400px] overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="py-12 text-center">
                  <Bell size={24} className="mx-auto mb-2 text-[var(--t4)]" />
                  <p className="text-sm text-[var(--t3)]">All clear</p>
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {notifications.map((notification: InAppNotificationRecord, index: number) => {
                    const Icon = NOTIF_ICONS[notification.notification_type] ?? NOTIF_ICONS.default
                    const color = NOTIF_COLORS[notification.notification_type] ?? NOTIF_COLORS.default
                    const target = notificationTarget(notification.action_url)

                    return (
                      <motion.div
                        key={notification.id}
                        initial={{ opacity: 0, x: 16 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.03 }}
                        data-testid={`notification-row-${notification.id}`}
                        className={`notification-row ${!notification.is_read ? 'notification-row--unread' : ''}`}
                        onClick={() => {
                          if (!target) return
                          if (target.startsWith('/')) {
                            navigate(target)
                          } else {
                            window.location.href = target
                          }
                          setOpen(false)
                        }}
                      >
                        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs ${color}`}>
                          <Icon size={14} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium leading-snug text-[var(--t1)]">
                            {notification.title}
                          </p>
                          {notification.message ? (
                            <p className="mt-0.5 line-clamp-2 text-xs text-[var(--t3)]">
                              {notification.message}
                            </p>
                          ) : null}
                          <p className="mt-1 font-mono text-[10px] text-[var(--t4)]">
                            {formatRelative(notification.created_at)}
                          </p>
                        </div>
                        <button
                          onClick={event => {
                            event.stopPropagation()
                            dismissMut.mutate(notification.id)
                          }}
                          data-testid={`notification-dismiss-${notification.id}`}
                          className="shrink-0 p-1 text-[var(--t4)] transition-colors hover:text-[var(--t3)]"
                        >
                          <X size={12} />
                        </button>
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
              )}
            </div>
          </motion.div>,
          document.body,
        ) : null}
    </div>
  )
}
