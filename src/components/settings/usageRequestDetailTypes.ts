export type UsageRequestStatus = 'succeeded' | 'failed' | 'cancelled' | 'other'

export interface RedactedUsageDetailField {
  id: string
  label: string
  value: string
  tone?: 'default' | 'success' | 'warning' | 'danger'
}

export interface RedactedUsageRequestDetail {
  requestId: string
  title: string
  subtitle?: string
  status: UsageRequestStatus
  statusLabel: string
  /** Values must be redacted before crossing into presentation. Raw request payloads are not accepted here. */
  fields: RedactedUsageDetailField[]
}

export type UsageRequestDetailState =
  | { status: 'loading'; requestId: string }
  | { status: 'error'; requestId: string; message: string }
  | { status: 'ready'; detail: RedactedUsageRequestDetail }
  | null
