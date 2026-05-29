import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import Placeholder from '@tiptap/extension-placeholder'
import Typography from '@tiptap/extension-typography'
import { CommentExtension } from '@sereneinserenade/tiptap-comment-extension'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Loader2, MessageSquare, Trash2, X } from 'lucide-react'
import * as Y from 'yjs'

import { commentsApi, extractApiError, filesApi } from '../../api/client'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from '../../lib/toast'

interface Props {
  room: string
  fileId: string
  readOnly?: boolean
  onSave?: (payload: { json: string; text: string; wordCount: number }) => void
  onContentChange?: (payload: { text: string; wordCount: number }) => void
  onSaveStateChange?: (state: 'saving' | 'saved') => void
  onPresenceChange?: (users: Array<{ name: string; color: string }>) => void
  minimalChrome?: boolean
  editorClassName?: string
}

function displayNameFromEmail(email: string | null) {
  const seed = email?.split('@')[0]?.replace(/[._-]+/g, ' ').trim() || 'CEO'
  return seed.charAt(0).toUpperCase() + seed.slice(1)
}

function countWords(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0
}

function formatRelative(isoString?: string | null) {
  if (!isoString) return 'just now'
  const date = new Date(isoString)
  const diff = Math.floor((Date.now() - date.getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return date.toLocaleDateString()
}

export function DocumentEditor({
  room,
  fileId,
  readOnly = false,
  onSave,
  onContentChange,
  onSaveStateChange,
  onPresenceChange,
  minimalChrome = false,
  editorClassName = '',
}: Props) {
  const { accessToken, email } = useAuth()
  const qc = useQueryClient()
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null)
  const [showCommentBtn, setShowCommentBtn] = useState(false)
  const [btnPos, setBtnPos] = useState({ top: 0, left: 0 })
  const [showCommentInput, setShowCommentInput] = useState(false)
  const [newCommentId, setNewCommentId] = useState<string | null>(null)
  const [newCommentText, setNewCommentText] = useState('')
  const [pendingQuotedText, setPendingQuotedText] = useState('')

  const commentsQuery = useQuery({
    queryKey: ['file-comments', fileId],
    queryFn: () => commentsApi.list(fileId),
    enabled: Boolean(fileId),
  })

  const ydoc = useMemo(() => new Y.Doc(), [room])
  const provider = useMemo(
    () =>
      new HocuspocusProvider({
        url:
          (import.meta.env.VITE_HOCUSPOCUS_URL as string | undefined) ||
          `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:1234`,
        name: room,
        document: ydoc,
        token: accessToken || '',
      }),
    [room, accessToken, ydoc],
  )

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ history: false }),
        Typography,
        Collaboration.configure({ document: ydoc }),
        CollaborationCursor.configure({
          provider,
          user: {
            name: displayNameFromEmail(email),
            color: '#6366F1',
          },
        }),
        CommentExtension.configure({
          HTMLAttributes: {
            class: 'aethon-comment',
          },
          onCommentActivated: commentId => {
            const nextId = commentId || null
            setActiveCommentId(nextId)
            if (nextId) {
              setTimeout(() => {
                document.getElementById(`comment-${nextId}`)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
              }, 0)
            }
          },
        }),
        Placeholder.configure({
          placeholder: 'Start writing... or let an agent draft for you.',
        }),
      ],
      editable: !readOnly,
      editorProps: {
        attributes: {
          class:
            `min-h-[420px] rounded-2xl px-4 py-5 text-[15px] leading-7 text-[var(--t1)] focus:outline-none ${editorClassName}`.trim(),
          'data-testid': 'document-editor',
        },
      },
    },
    [provider, ydoc, readOnly, email],
  )

  const createCommentMutation = useMutation({
    mutationFn: (payload: { comment_id: string; content: string; quoted_text?: string | null }) =>
      commentsApi.create(fileId, payload),
    onSuccess: comment => {
      void qc.invalidateQueries({ queryKey: ['file-comments', fileId] })
      setShowCommentInput(false)
      setNewCommentId(null)
      setNewCommentText('')
      setPendingQuotedText('')
      setActiveCommentId(comment.comment_id)
      toast.success('Comment added')
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const resolveCommentMutation = useMutation({
    mutationFn: (commentId: string) => commentsApi.resolve(fileId, commentId),
    onSuccess: (_, commentId) => {
      editor?.chain().focus().unsetComment(commentId).run()
      void qc.invalidateQueries({ queryKey: ['file-comments', fileId] })
      if (activeCommentId === commentId) setActiveCommentId(null)
      toast.success('Comment resolved')
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const deleteCommentMutation = useMutation({
    mutationFn: (commentId: string) => commentsApi.remove(fileId, commentId),
    onSuccess: (_, commentId) => {
      editor?.chain().focus().unsetComment(commentId).run()
      void qc.invalidateQueries({ queryKey: ['file-comments', fileId] })
      if (activeCommentId === commentId) setActiveCommentId(null)
      toast.success('Comment removed')
    },
    onError: error => toast.error(extractApiError(error)),
  })

  const focusCommentInEditor = (commentId: string) => {
    if (!editor) return
    let range: { from: number; to: number } | null = null

    editor.state.doc.descendants((node, pos) => {
      const mark = node.marks.find(
        item => item.type.name === 'comment' && item.attrs.commentId === commentId,
      )
      if (!mark) return true
      range = { from: pos, to: pos + node.nodeSize }
      return false
    })

    setActiveCommentId(commentId)
    setShowCommentBtn(false)

    if (!range) return
    editor.chain().focus().setTextSelection(range).run()
    const target = editor.view.dom.querySelector<HTMLElement>(`[data-comment-id="${commentId}"]`)
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const cancelCommentDraft = () => {
    if (newCommentId && editor) {
      editor.chain().focus().unsetComment(newCommentId).run()
    }
    setShowCommentInput(false)
    setNewCommentId(null)
    setNewCommentText('')
    setPendingQuotedText('')
    setActiveCommentId(null)
  }

  const addComment = () => {
    if (!editor) return
    const { from, to } = editor.state.selection
    if (from === to) return
    const selectedText = editor.state.doc.textBetween(from, to).trim()
    if (!selectedText) return

    const commentId = `comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    editor.chain().focus().setComment(commentId).run()
    setShowCommentBtn(false)
    setActiveCommentId(commentId)
    setNewCommentId(commentId)
    setNewCommentText('')
    setPendingQuotedText(selectedText)
    setShowCommentInput(true)
  }

  useEffect(() => {
    if (!editor) return undefined
    const handleUpdate = () => {
      const text = editor.getText()
      const nextWordCount = countWords(text)
      onContentChange?.({ text, wordCount: nextWordCount })
      onSaveStateChange?.('saving')
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        const json = JSON.stringify(editor.getJSON())
        onSave?.({ json, text, wordCount: nextWordCount })
        void filesApi.update(fileId, { extracted_text: text })
          .finally(() => onSaveStateChange?.('saved'))
      }, 2000)
    }

    editor.on('update', handleUpdate)
    return () => {
      editor.off('update', handleUpdate)
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [editor, fileId, onContentChange, onSave, onSaveStateChange])

  useEffect(() => {
    if (!editor) return undefined

    const handleSelectionUpdate = () => {
      if (readOnly || showCommentInput) {
        setShowCommentBtn(false)
        return
      }
      const { from, to } = editor.state.selection
      if (from === to) {
        setShowCommentBtn(false)
        return
      }
      const selectedText = editor.state.doc.textBetween(from, to).trim()
      if (!selectedText) {
        setShowCommentBtn(false)
        return
      }
      let selectingExistingComment = false
      editor.state.doc.nodesBetween(from, to, node => {
        if (node.marks.some(mark => mark.type.name === 'comment')) {
          selectingExistingComment = true
          return false
        }
        return true
      })
      if (selectingExistingComment) {
        setShowCommentBtn(false)
        return
      }
      try {
        const coords = editor.view.coordsAtPos(to)
        setBtnPos({
          top: Math.max(coords.top - 40, 16),
          left: coords.left,
        })
        setShowCommentBtn(true)
      } catch {
        setShowCommentBtn(false)
      }
    }

    const hideCommentButton = () => setShowCommentBtn(false)

    editor.on('selectionUpdate', handleSelectionUpdate)
    editor.on('blur', hideCommentButton)

    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate)
      editor.off('blur', hideCommentButton)
    }
  }, [editor, readOnly, showCommentInput])

  useEffect(() => {
    const awareness = provider.awareness
    if (!awareness || !onPresenceChange) return undefined
    const emit = () => {
      const users = Array.from(awareness.getStates().values())
        .map(state => {
          const user = (state as { user?: { name?: string; color?: string } }).user
          if (!user?.name) return null
          return {
            name: user.name,
            color: user.color || '#6366F1',
          }
        })
        .filter(Boolean) as Array<{ name: string; color: string }>
      onPresenceChange(users)
    }
    awareness.on('change', emit)
    emit()
    return () => awareness.off('change', emit)
  }, [onPresenceChange, provider.awareness])

  useEffect(() => {
    if (!editor) return
    const nodes = editor.view.dom.querySelectorAll<HTMLElement>('[data-comment-id]')
    nodes.forEach(node => {
      node.classList.toggle('active', node.dataset.commentId === activeCommentId)
    })
  }, [activeCommentId, commentsQuery.data, editor])

  useEffect(() => {
    return () => {
      provider.destroy()
      ydoc.destroy()
    }
  }, [provider, ydoc])

  const comments = commentsQuery.data ?? []

  return (
    <div className="relative overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--card)]">
      {!minimalChrome ? (
        <div className="border-b border-[var(--border)] px-4 py-3 text-xs font-mono uppercase tracking-[0.2em] text-[var(--t3)]">
          Collaborative document
        </div>
      ) : null}

      <div className="grid 2xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="relative min-w-0 border-b border-[var(--border)] 2xl:border-b-0 2xl:border-r">
          <EditorContent editor={editor} />

          <AnimatePresence>
            {showCommentBtn ? (
              <motion.button
                type="button"
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.92 }}
                className="fixed z-50 flex items-center gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-300 shadow-lg transition-colors hover:bg-amber-500/18"
                style={{ top: btnPos.top, left: btnPos.left }}
                onMouseDown={event => event.preventDefault()}
                onClick={addComment}
              >
                <MessageSquare size={12} />
                Comment
              </motion.button>
            ) : null}
          </AnimatePresence>
        </div>

        <aside className="border-t border-[var(--border)] bg-[var(--bg-s)] px-4 py-4 2xl:border-t-0">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="section-title">Comments</div>
              <p className="text-xs text-[var(--t3)]">
                {comments.length > 0 ? `${comments.length} open` : 'No open comments'}
              </p>
            </div>
          </div>

          {showCommentInput ? (
            <div className="mb-3 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-3">
              {pendingQuotedText ? (
                <div className="mb-2 rounded-xl border border-amber-500/15 bg-black/10 px-3 py-2 text-xs text-[var(--t2)]">
                  “{pendingQuotedText}”
                </div>
              ) : null}
              <textarea
                value={newCommentText}
                onChange={event => setNewCommentText(event.target.value)}
                placeholder="Add feedback or a revision note…"
                className="min-h-[90px] w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--t1)] outline-none transition focus:border-amber-500/35"
              />
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={cancelCommentDraft}
                  disabled={createCommentMutation.isPending}
                >
                  <X size={14} />
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => {
                    const trimmed = newCommentText.trim()
                    if (!trimmed || !newCommentId) return
                    createCommentMutation.mutate({
                      comment_id: newCommentId,
                      content: trimmed,
                      quoted_text: pendingQuotedText || null,
                    })
                  }}
                  disabled={createCommentMutation.isPending || !newCommentText.trim()}
                >
                  {createCommentMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check size={14} />
                  )}
                  Save comment
                </button>
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            {commentsQuery.isLoading ? (
              <div className="row rounded-2xl border border-[var(--border)] bg-[var(--bg)] text-[var(--t3)]">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading comments…
              </div>
            ) : comments.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--bg)] px-4 py-5 text-sm text-[var(--t3)]">
                Select text in the editor to leave an inline comment.
              </div>
            ) : (
              comments.map(comment => (
                <div
                  key={comment.id}
                  id={`comment-${comment.comment_id}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => focusCommentInEditor(comment.comment_id)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      focusCommentInEditor(comment.comment_id)
                    }
                  }}
                  className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                    activeCommentId === comment.comment_id
                      ? 'border-amber-500/30 bg-amber-500/[0.08]'
                      : 'border-[var(--border)] bg-[var(--bg)] hover:border-amber-500/20'
                  }`}
                >
                  {comment.quoted_text ? (
                    <div className="mb-2 rounded-xl border border-[var(--border)] bg-[var(--bg-s)] px-3 py-2 text-xs text-[var(--t2)]">
                      “{comment.quoted_text}”
                    </div>
                  ) : null}
                  <p className="text-sm leading-6 text-[var(--t1)]">{comment.content}</p>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-medium text-[var(--t2)]">
                        {comment.created_by_name || 'Team member'}
                      </p>
                      <p className="font-mono text-[10px] text-[var(--t4)]">
                        {formatRelative(comment.created_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={event => {
                          event.stopPropagation()
                          resolveCommentMutation.mutate(comment.comment_id)
                        }}
                        disabled={resolveCommentMutation.isPending}
                      >
                        <Check size={13} />
                        Resolve
                      </button>
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={event => {
                          event.stopPropagation()
                          deleteCommentMutation.mutate(comment.comment_id)
                        }}
                        disabled={deleteCommentMutation.isPending}
                        aria-label="Delete comment"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
