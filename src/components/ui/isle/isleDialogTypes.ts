import type { ReactNode } from 'react'
import type { AppFeedbackOptions, AppFeedbackTone } from '@/components/ui/appFeedbackState'

export type DialogTone = AppFeedbackTone
export interface IsleDialogChip { label: string; tone?: DialogTone }
export interface IsleDialogMetric { label: string; before?: string; after?: string; tone?: DialogTone }

export interface ConfirmOptions {
  title: string
  /** Cancels this pending confirmation only; used by request-scoped consent. */
  signal?: AbortSignal
  /** Synchronous consent receipt; runs before the confirmation promise settles. */
  onConfirm?: () => void
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: DialogTone
  chips?: IsleDialogChip[]
  metrics?: IsleDialogMetric[]
  renderBody?: () => ReactNode
}
export interface NoticeOptions {
  title: string
  message?: string
  tone?: DialogTone
  actionLabel?: string
  renderBody?: () => ReactNode
}
export interface ToastOptions extends AppFeedbackOptions {}
export interface BannerOptions extends Omit<AppFeedbackOptions, 'durationMs' | 'position' | 'topOffset' | 'bottomOffset' | 'priority'> {
  id?: string
}
export interface IsleDialogApi {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  notice: (options: NoticeOptions) => void
  toast: (options: ToastOptions) => void
  banner: (options: BannerOptions) => string
  dismissBanner: (id: string) => void
  hasPendingDialogs: () => boolean
  subscribeDialogs: (listener: () => void) => () => void
}
