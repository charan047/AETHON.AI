import { useState, useEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { Sidebar } from './Sidebar'
import { useWebSocket } from '../../hooks/useWebSocket'
import { executionsApi } from '../../api/client'
import { Sparkles, X, Bot } from 'lucide-react'
import { CommandPalette } from '../CommandPalette'

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
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-3xl max-h-[80vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-900/40 flex items-center justify-center">
              <Sparkles size={16} className="text-emerald-400" />
            </div>
            <div>
              <div className="font-semibold text-slate-100">Workflow Result</div>
              {execution && (
                <div className="text-xs text-slate-500 mt-0.5">
                  {execution.token_count} tokens · ${execution.cost.toFixed(5)} · {execution.status}
                </div>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-slate-300 rounded-lg hover:bg-slate-800 transition-colors">
            <X size={18} />
          </button>
        </div>
        {execution?.input_message && (
          <div className="px-5 pt-4 flex-shrink-0">
            <div className="text-xs text-slate-500 font-medium mb-1.5 uppercase tracking-wide">Your Query</div>
            <div className="bg-slate-800 rounded-lg px-4 py-3 text-sm text-slate-300 border border-slate-700">{execution.input_message}</div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="text-xs text-slate-500 font-medium mb-1.5 uppercase tracking-wide flex items-center gap-1.5">
            <Bot size={12} /> Agent Response
          </div>
          {isLoading ? (
            <div className="flex items-center gap-2 text-slate-500 text-sm py-8 justify-center">
              <div className="w-4 h-4 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /> Loading result...
            </div>
          ) : (
            <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
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
      // Chat page shows results inline — no popup needed there
      if (!location.pathname.startsWith('/chat/')) {
        setResultId(execId)
      }
    }
  }, [events, qc, location.pathname])

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="app-shell flex-1 overflow-y-auto bg-obsidian-950">
        <Outlet />
      </main>
      <CommandPalette />
      {resultId && <GlobalResultModal executionId={resultId} onClose={() => setResultId(null)} />}
    </div>
  )
}
