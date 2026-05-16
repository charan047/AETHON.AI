import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Bell, Mail, ShieldAlert } from 'lucide-react'
import { extractApiError, notificationsApi } from '../api/client'
import type { NotificationPreference } from '../types'
import { toast } from '../lib/toast'

const DEFAULT_PREFS: NotificationPreference = {
  email_on_approval_needed: true,
  email_on_execution_complete: false,
  email_on_autonomy_change: true,
  daily_digest_enabled: true,
  daily_digest_time: '08:00',
  notification_email: '',
}

export function NotificationsSettings() {
  const { data, isLoading } = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: notificationsApi.preferences,
  })
  const [prefs, setPrefs] = useState<NotificationPreference>(DEFAULT_PREFS)

  useEffect(() => {
    if (data) setPrefs({ ...DEFAULT_PREFS, ...data })
  }, [data])

  const save = useMutation({
    mutationFn: () => notificationsApi.updatePreferences(prefs),
    onSuccess: updated => {
      setPrefs({ ...DEFAULT_PREFS, ...updated })
      toast.success('Notification preferences saved')
    },
    onError: error => toast.error(extractApiError(error)),
  })

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6 animate-fade-up">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#4B5A73]">Notifications</p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-white">Alerts and digests</h1>
        <p className="mt-2 text-sm text-[#8B9DBE]">
          Decide when Aethon emails you about approvals, executions, autonomy changes, and daily summaries.
        </p>
      </div>

      <section className="glass-card p-6">
        <div className="mb-6 flex items-start gap-3">
          <div className="rounded-2xl bg-blue-600/12 p-3 text-blue-400">
            <Bell size={20} />
          </div>
          <div>
            <h2 className="text-lg font-extrabold tracking-tight text-white">Email notifications</h2>
            <p className="mt-1 text-sm text-[#8B9DBE]">
              Choose which automation and governance events should reach your inbox.
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="text-sm text-[#8B9DBE]">Loading preferences…</div>
        ) : (
          <div className="space-y-5">
            <div>
              <label className="label">Notification email</label>
              <input
                className="input"
                value={prefs.notification_email || ''}
                placeholder="owner@example.com"
                onChange={event => setPrefs(current => ({ ...current, notification_email: event.target.value }))}
              />
              <p className="mt-1 text-xs text-[#4B5A73]">
                Leave blank to use your account email address.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {[
                {
                  key: 'email_on_approval_needed' as const,
                  title: 'Approval needed',
                  detail: 'Email me when an agent pauses for approval.',
                  icon: ShieldAlert,
                },
                {
                  key: 'email_on_execution_complete' as const,
                  title: 'Execution complete',
                  detail: 'Email me when scheduled or manual runs finish.',
                  icon: Mail,
                },
                {
                  key: 'email_on_autonomy_change' as const,
                  title: 'Autonomy changed',
                  detail: 'Email me when an agent is promoted or restricted.',
                  icon: Bell,
                },
                {
                  key: 'daily_digest_enabled' as const,
                  title: 'Daily digest',
                  detail: 'Send me a summary of work completed and approvals waiting.',
                  icon: Mail,
                },
              ].map(item => {
                const Icon = item.icon
                const enabled = Boolean(prefs[item.key])
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setPrefs(current => ({ ...current, [item.key]: !current[item.key] }))}
                    className="glass-card cursor-pointer rounded-2xl p-4 text-left transition-all duration-150 hover:bg-white/[0.04]"
                  >
                    <div className="flex items-start gap-3">
                      <div className="rounded-xl bg-white/[0.04] p-2 text-[#8B9DBE]">
                        <Icon size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-white">{item.title}</p>
                          <span className={enabled ? 'badge-emerald' : 'badge-glass'}>
                            {enabled ? 'Enabled' : 'Off'}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-[#8B9DBE]">{item.detail}</p>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="max-w-xs">
              <label className="label">Daily digest time</label>
              <input
                className="input"
                type="time"
                value={prefs.daily_digest_time}
                onChange={event => setPrefs(current => ({ ...current, daily_digest_time: event.target.value }))}
              />
            </div>

            <div className="flex justify-end">
              <button className="btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? 'Saving…' : 'Save Preferences'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
