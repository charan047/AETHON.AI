import { useState, useEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { Sidebar } from './Sidebar'
import { useWebSocket } from '../../hooks/useWebSocket'
import { executionsApi } from '../../api/client'
import { Sparkles, X, Bot, PanelLeft } from 'lucide-react'

function GlobalResultModal({ executionId, onClose }: { executionId: string; onClose: () => void }) {
  const { data: execution, isLoading } = useQuery({
    queryKey: ['execution', executionId],
    queryFn: () => executionsApi.get(executionId),
  })
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-elevated flex max-h-[80vh] w-full max-w-3xl flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex flex-shrink-0 items-center justify-between border-b border-white/[0.08] p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600/12">
              <Sparkles size={16} className="text-blue-400" />
            </div>
            <div>
              <div className="font-semibold text-white">Workflow Result</div>
              {execution && (
                <div className="mt-0.5 text-xs text-ink-secondary">
                  {(execution.token_count ?? 0)} tokens · ${(execution.cost ?? 0).toFixed(5)} · {execution.status}
                </div>
              )}
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-white/[0.04] hover:text-white">
            <X size={18} />
          </button>
        </div>
        {execution?.input_message && (
          <div className="flex-shrink-0 px-5 pt-4">
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted">Your Query</div>
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-ink-secondary">{execution.input_message}</div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted">
            <Bot size={12} /> Agent Response
          </div>
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-ink-secondary">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" /> Loading result...
            </div>
          ) : (
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-sm leading-relaxed text-ink-primary whitespace-pre-wrap">
              {execution?.output_message || 'No output yet — the workflow may still be running.'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function Layout() {
  const qc = useQueryClient()
  const { events } = useWebSocket()
  const location = useLocation()
  const [resultId, setResultId] = useState<string | null>(null)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  // Track the last execution ID we already handled so navigating between pages
  // doesn't re-trigger the popup for a stale event still sitting in the buffer.
  const lastHandledId = useRef<string | null>(null)

  useEffect(() => {
    const last = events[events.length - 1]
    if (last?.type === 'execution_complete' && last.execution_id) {
      const execId = last.execution_id as string
      if (execId === lastHandledId.current) return   // already handled — skip
      lastHandledId.current = execId
      qc.invalidateQueries({ queryKey: ['recent-executions'] })
      qc.invalidateQueries({ queryKey: ['execution', execId] })
      // Chat and dedicated execution pages already show results inline.
      if (!location.pathname.startsWith('/chat/') && !location.pathname.startsWith('/executions/')) {
        setResultId(execId)
      }
    }
  }, [events, qc, location.pathname])

  useEffect(() => {
    setMobileSidebarOpen(false)
  }, [location.pathname])

  return (
    <div className="relative flex h-screen overflow-hidden bg-base-100 text-content-primary">
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-0 h-[280px]"
        style={{
          background:
            'radial-gradient(ellipse 70% 60% at 50% 0%, rgba(37,99,235,0.14) 0%, rgba(16,185,129,0.08) 35%, transparent 75%)',
        }}
      />
      <div className="relative z-10 flex h-full w-full overflow-hidden">
        {mobileSidebarOpen && (
          <button
            type="button"
            aria-label="Close navigation"
            className="fixed inset-0 z-20 bg-black/45 lg:hidden"
            onClick={() => setMobileSidebarOpen(false)}
          />
        )}
        <Sidebar mobileOpen={mobileSidebarOpen} onCloseMobile={() => setMobileSidebarOpen(false)} />
        <main className="app-shell relative flex flex-1 flex-col overflow-hidden bg-transparent">
          <div className="flex h-14 items-center px-4 shadow-[0_1px_0_rgba(255,255,255,0.06)] lg:hidden">
            <button
              type="button"
              aria-label="Open navigation"
              onClick={() => setMobileSidebarOpen(true)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-white/80 transition duration-150 hover:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              <PanelLeft size={18} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <Outlet />
          </div>
        </main>
      </div>
      {resultId && <GlobalResultModal executionId={resultId} onClose={() => setResultId(null)} />}
    </div>
  )
}
