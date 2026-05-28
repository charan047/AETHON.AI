import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AlertTriangle, Bell, Mail, ShieldAlert } from 'lucide-react'
import { extractApiError, integrationsApi, notificationsApi } from '../api/client'
import { FloatingField } from '../components/AuthShell'
import { GlassCard } from '../components/ui/GlassCard'
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

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: () => void
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={checked ? 'flex h-6 w-11 items-center rounded-full bg-indigo-500/80 px-0.5 transition-all duration-200' : 'flex h-6 w-11 items-center rounded-full bg-white/[0.10] px-0.5 transition-all duration-200'}
    >
      <span
        className={checked ? 'h-5 w-5 translate-x-5 rounded-full bg-white transition-transform duration-200' : 'h-5 w-5 translate-x-0 rounded-full bg-white transition-transform duration-200'}
      />
    </button>
  )
}

export function NotificationsSettings() {
  const { data, isLoading } = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: notificationsApi.preferences,
  })
  const { data: integrations = [] } = useQuery({
    queryKey: ['integrations'],
    queryFn: integrationsApi.list,
  })

  const [prefs, setPrefs] = useState<NotificationPreference>(DEFAULT_PREFS)
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('587')
  const [smtpUser, setSmtpUser] = useState('')
  const [smtpPassword, setSmtpPassword] = useState('')

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

  const hasEmailIntegration = integrations.some(
    integration => integration.is_active && (integration.integration_type === 'email_smtp' || integration.integration_type === 'gmail'),
  )

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="page-header rounded-[24px] border border-white/[0.06] bg-white/[0.02]">
        <div>
          <h1 className="page-title">Notifications</h1>
          <p className="page-sub">Alerts and digests</p>
        </div>
      </div>

      <GlassCard padding="lg" className="rounded-[28px] border-white/[0.08] bg-white/[0.03]">
        <div className="section-title">Email Notifications</div>

        {isLoading ? (
          <div className="text-sm text-[#8B9DBE]">Loading preferences…</div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              {[
                {
                  key: 'email_on_approval_needed' as const,
                  title: 'Approval needed',
                  detail: 'Default on. Email me when an agent pauses for approval.',
                  icon: ShieldAlert,
                },
                {
                  key: 'email_on_execution_complete' as const,
                  title: 'Execution complete',
                  detail: 'Default off. Email me when scheduled or manual runs finish.',
                  icon: Mail,
                },
                {
                  key: 'email_on_autonomy_change' as const,
                  title: 'Autonomy change',
                  detail: 'Default on. Email me when an agent is promoted or restricted.',
                  icon: Bell,
                },
              ].map(item => {
                const Icon = item.icon
                const enabled = Boolean(prefs[item.key])

                return (
                  <div key={item.key} className="row min-h-[48px]">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.05] text-indigo-300">
                      <Icon size={15} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-white">{item.title}</div>
                      <div className="text-xs text-[#8B9DBE]">{item.detail}</div>
                    </div>
                    <ToggleSwitch
                      checked={enabled}
                      onChange={() => setPrefs(current => ({ ...current, [item.key]: !current[item.key] }))}
                    />
                  </div>
                )
              })}
            </div>

            <FloatingField
              label="Custom email"
              type="email"
              value={prefs.notification_email || ''}
              onChange={value => setPrefs(current => ({ ...current, notification_email: value }))}
            />

            <div className="flex justify-end">
              <button className="btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? 'Saving…' : 'Save Preferences'}
              </button>
            </div>
          </div>
        )}
      </GlassCard>

      <GlassCard padding="lg" className="rounded-[28px] border-white/[0.08] bg-white/[0.03]">
        <div className="section-title">Daily Digest</div>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-white">Daily digest</div>
              <div className="text-xs text-[#8B9DBE]">Receive a summary of work completed and approvals waiting.</div>
            </div>
            <ToggleSwitch
              checked={Boolean(prefs.daily_digest_enabled)}
              onChange={() => setPrefs(current => ({ ...current, daily_digest_enabled: !current.daily_digest_enabled }))}
            />
          </div>
        </div>

        <div className="mt-4 max-w-sm">
          <FloatingField
            label="Digest time"
            type="time"
            value={prefs.daily_digest_time}
            onChange={value => setPrefs(current => ({ ...current, daily_digest_time: value }))}
          />
        </div>

        <div className="mt-4 flex justify-end">
          <button className="btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save Digest'}
          </button>
        </div>
      </GlassCard>

      {!hasEmailIntegration && (
        <section className="card-amber rounded-[28px] border border-amber-400/20 bg-amber-950/20 p-6">
          <div className="section-title mb-4 border-amber-400/20 text-amber-200">SMTP</div>
          <div className="mb-4 flex items-start gap-3 text-amber-100">
            <AlertTriangle className="mt-0.5 text-amber-300" size={18} />
            <div>
              <div className="text-sm font-semibold">Configure SMTP to send email notifications</div>
              <div className="mt-1 text-xs text-amber-100/70">
                Connect Gmail or an SMTP integration on the Integrations page to activate delivery.
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <FloatingField label="SMTP host" type="text" value={smtpHost} onChange={setSmtpHost} />
            <FloatingField label="SMTP port" type="number" value={smtpPort} onChange={setSmtpPort} />
            <FloatingField label="SMTP user" type="text" value={smtpUser} onChange={setSmtpUser} />
            <FloatingField label="SMTP password" type="password" value={smtpPassword} onChange={setSmtpPassword} />
          </div>
        </section>
      )}
    </div>
  )
}
