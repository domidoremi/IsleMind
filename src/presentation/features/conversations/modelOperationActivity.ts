import type { ProcessTrace } from '@/core'
import type { ConversationRunProjectionEvent } from '@/modules/conversations'
import { projectOperationActivity } from '@/modules/assistant-runtime'

/** Chat and task detail share the same receipt-owned status semantics. */
export function modelOperationActivity(event: ConversationRunProjectionEvent): ProcessTrace | undefined {
  return event.journalEntry ? projectOperationActivity(event.journalEntry) : undefined
}
