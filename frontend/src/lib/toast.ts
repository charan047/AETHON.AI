import type { ReactNode } from 'react'
import { toast as sonnerToast } from 'sonner'

export const toast = {
  success: (msg: string) => sonnerToast.success(msg),
  error: (msg: string) => sonnerToast.error(msg),
  info: (msg: string) => sonnerToast(msg),
  warning: (msg: string) => sonnerToast.warning(msg),
  custom: (content: ReactNode, options?: { duration?: number; icon?: ReactNode | null }) => sonnerToast(content, options),
  promise: <T>(
    promise: Promise<T>,
    messages: { loading: string; success: string; error: string },
  ) => sonnerToast.promise(promise, messages),
}
