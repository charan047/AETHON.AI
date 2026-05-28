import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Loader2, Send, Zap } from 'lucide-react'
import { useParams } from 'react-router-dom'

import { extractApiError, intakeApi } from '../api/client'
import { DotGrid } from '../components/reactbits/DotGrid'
import { toast } from '../lib/toast'

export function PublicIntakeForm() {
  const { token = '' } = useParams()
  const [values, setValues] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState(false)

  const formQuery = useQuery({
    queryKey: ['public-intake-form', token],
    queryFn: () => intakeApi.getPublicForm(token),
    enabled: Boolean(token),
  })

  const fields = useMemo(() => formQuery.data?.fields || [], [formQuery.data?.fields])

  const submitMutation = useMutation({
    mutationFn: async () => {
      const missing = fields.filter(field => field.required && !(values[field.name] || '').trim())
      if (missing.length) {
        throw new Error(`Please fill: ${missing.map(field => field.label).join(', ')}`)
      }
      return intakeApi.submitPublicForm(token, values)
    },
    onSuccess: () => {
      setSubmitted(true)
      toast.success('Brief received')
    },
    onError: error => toast.error(extractApiError(error)),
  })

  if (formQuery.isLoading) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-[#FAF8F3] text-[#111111]">
        <DotGrid className="pointer-events-none absolute inset-0 opacity-40" dotColor="#D6D3D1" gap={20} />
        <div className="grid min-h-screen place-items-center p-6">
          <div className="card w-full max-w-lg p-8 text-center">
            <Loader2 className="mx-auto animate-spin text-indigo-500" />
            <p className="mt-3 text-sm text-[var(--t3)]">Loading intake form…</p>
          </div>
        </div>
      </div>
    )
  }

  if (formQuery.isError || !formQuery.data) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-[#FAF8F3] text-[#111111]">
        <DotGrid className="pointer-events-none absolute inset-0 opacity-40" dotColor="#D6D3D1" gap={20} />
        <div className="grid min-h-screen place-items-center p-6">
          <div className="card w-full max-w-lg p-8 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--t1)]">This intake link is unavailable</h1>
            <p className="mt-3 text-sm text-[var(--t3)]">{extractApiError(formQuery.error)}</p>
          </div>
        </div>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-[#FAF8F3] text-[#111111]">
        <DotGrid className="pointer-events-none absolute inset-0 opacity-40" dotColor="#D6D3D1" gap={20} />
        <div className="grid min-h-screen place-items-center p-6">
          <div className="card w-full max-w-xl p-10 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500 text-white">
              <Send size={18} />
            </div>
            <h1 className="mt-5 text-3xl font-bold tracking-tight text-[var(--t1)]">Thank you.</h1>
            <p className="mt-3 text-base text-[var(--t2)]">Your brief has been received.</p>
            <p className="mt-2 text-sm text-[var(--t3)]">The agency has the details and will take it from here.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#FAF8F3] text-[#111111]">
      <DotGrid className="pointer-events-none absolute inset-0 opacity-40" dotColor="#D6D3D1" gap={20} />
      <div className="relative mx-auto flex min-h-screen w-full max-w-3xl items-center p-5 sm:p-8">
        <div className="card w-full p-6 sm:p-8">
          <div className="mb-8 flex items-start gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-500 text-white shadow-[0_10px_30px_rgba(99,102,241,0.25)]">
              <Zap size={18} />
            </div>
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-indigo-500">Client Intake</div>
              <h1 className="mt-2 text-[clamp(28px,4vw,40px)] font-extrabold tracking-[-0.04em] text-[var(--t1)]">
                {formQuery.data.title}
              </h1>
              <p className="mt-2 text-sm text-[var(--t3)]">
                Share the details below and the agency will turn this into an active workflow.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {fields.map(field => {
              const value = values[field.name] || ''
              return (
                <label key={field.name} className="block">
                  <div className="mb-2 text-sm font-medium text-[var(--t2)]">
                    {field.label}
                    {field.required ? <span className="ml-1 text-red-500">*</span> : null}
                  </div>
                  {field.type === 'textarea' ? (
                    <textarea
                      className="min-h-[132px] w-full rounded-2xl border border-[#D6D3D1] bg-white px-4 py-3 text-sm text-[#111111] outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
                      value={value}
                      onChange={event => setValues(current => ({ ...current, [field.name]: event.target.value }))}
                    />
                  ) : (
                    <input
                      className="h-12 w-full rounded-2xl border border-[#D6D3D1] bg-white px-4 text-sm text-[#111111] outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
                      value={value}
                      onChange={event => setValues(current => ({ ...current, [field.name]: event.target.value }))}
                    />
                  )}
                </label>
              )
            })}
          </div>

          <div className="mt-8 flex justify-end">
            <button
              className="btn-primary h-12 min-w-[180px]"
              disabled={submitMutation.isPending}
              onClick={() => submitMutation.mutate()}
            >
              {submitMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={15} />}
              Submit Brief
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
