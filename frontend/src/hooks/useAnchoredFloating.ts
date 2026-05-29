import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'

type VerticalPreference = 'above' | 'below'
type HorizontalPreference = 'start' | 'end'

export function useAnchoredFloating({
  open,
  anchorRef,
  panelRef,
  vertical = 'below',
  horizontal = 'end',
  offset = 10,
  padding = 16,
  avoidRef,
  preferOutsideSidebar = false,
}: {
  open: boolean
  anchorRef: RefObject<HTMLElement | null>
  panelRef: RefObject<HTMLElement | null>
  vertical?: VerticalPreference
  horizontal?: HorizontalPreference
  offset?: number
  padding?: number
  avoidRef?: RefObject<HTMLElement | null>
  preferOutsideSidebar?: boolean
}) {
  const [style, setStyle] = useState<CSSProperties>({ opacity: 0, pointerEvents: 'none' })

  useLayoutEffect(() => {
    if (!open) {
      setStyle({ opacity: 0, pointerEvents: 'none' })
      return
    }

    const update = () => {
      const anchor = anchorRef.current
      const panel = panelRef.current
      if (!anchor || !panel) return

      const anchorRect = anchor.getBoundingClientRect()
      const panelRect = panel.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      let left = horizontal === 'start' ? anchorRect.left : anchorRect.right - panelRect.width

      if (preferOutsideSidebar) {
        const sidebarRect = anchor.closest('aside')?.getBoundingClientRect()
        if (sidebarRect && sidebarRect.right + offset + panelRect.width <= viewportWidth - padding) {
          left = sidebarRect.right + offset
        }
      }

      const avoidRect = avoidRef?.current?.getBoundingClientRect()
      if (avoidRect && left + panelRect.width > avoidRect.left - offset) {
        left = avoidRect.left - offset - panelRect.width
      }

      left = Math.max(padding, Math.min(left, viewportWidth - panelRect.width - padding))

      const belowTop = anchorRect.bottom + offset
      const aboveTop = anchorRect.top - panelRect.height - offset

      let top =
        vertical === 'above'
          ? (aboveTop >= padding ? aboveTop : belowTop)
          : (belowTop + panelRect.height <= viewportHeight - padding ? belowTop : aboveTop)

      top = Math.max(padding, Math.min(top, viewportHeight - panelRect.height - padding))

      setStyle({
        position: 'fixed',
        top,
        left,
        opacity: 1,
        pointerEvents: 'auto',
      })
    }

    update()

    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, anchorRef, panelRef, vertical, horizontal, offset, padding, avoidRef, preferOutsideSidebar])

  return style
}
