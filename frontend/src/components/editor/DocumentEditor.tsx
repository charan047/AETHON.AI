import { useEffect, useMemo, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import Placeholder from '@tiptap/extension-placeholder'
import Typography from '@tiptap/extension-typography'
import { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'
import { filesApi } from '../../api/client'
import { useAuth } from '../../contexts/AuthContext'

interface Props {
  room: string
  fileId: string
  readOnly?: boolean
  onSave?: (payload: { json: string; text: string; wordCount: number }) => void
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

export function DocumentEditor({
  room,
  fileId,
  readOnly = false,
  onSave,
  onSaveStateChange,
  onPresenceChange,
  minimalChrome = false,
  editorClassName = '',
}: Props) {
  const { accessToken, email } = useAuth()
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  useEffect(() => {
    if (!editor) return undefined
    const handleUpdate = () => {
      onSaveStateChange?.('saving')
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        const json = JSON.stringify(editor.getJSON())
        const text = editor.getText()
        onSave?.({ json, text, wordCount: countWords(text) })
        void filesApi.update(fileId, { extracted_text: text })
          .finally(() => onSaveStateChange?.('saved'))
      }, 2000)
    }

    editor.on('update', handleUpdate)
    return () => {
      editor.off('update', handleUpdate)
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [editor, fileId, onSave])

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
    return () => {
      provider.destroy()
      ydoc.destroy()
    }
  }, [provider, ydoc])

  return (
    <div className="relative overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--card)]">
      {!minimalChrome ? (
        <div className="border-b border-[var(--border)] px-4 py-3 text-xs font-mono uppercase tracking-[0.2em] text-[var(--t3)]">
          Collaborative document
        </div>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  )
}
