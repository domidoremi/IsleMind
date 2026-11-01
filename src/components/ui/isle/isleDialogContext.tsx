import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { IsleDialogApi, ToastOptions } from './isleDialogTypes'

export const IsleDialogContext = createContext<IsleDialogApi | null>(null)

/** Only routine feedback is scoped; confirmations keep their original owner. */
export function IsleLocalFeedbackProvider({ children, onFeedback }: {
  children: ReactNode
  onFeedback: (options: ToastOptions) => void
}) {
  const parent = useContext(IsleDialogContext)
  const api = useMemo(() => parent ? { ...parent, toast: onFeedback } : null, [parent, onFeedback])
  return <IsleDialogContext.Provider value={api}>{children}</IsleDialogContext.Provider>
}
