import type { AssistantRunId } from '@/core'

export interface TavernChatWorkspaceWritebackReceiptLookupIdentity {
  readonly assistantRunId: AssistantRunId
  readonly conversationId: string
  readonly assistantMessageId: string
}

export interface TavernChatWorkspaceWritebackCommittedReceipt {
  readonly assistantRunId: AssistantRunId
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly workspaceId: string
  readonly expectedAuthorityRevision: number
  readonly idempotencyKey: string
  readonly outcomeStatus: 'applied' | 'no_changes'
  readonly authorityRevision: number
  readonly createdAt: number
}

export type TavernChatWorkspaceWritebackReceiptLookupFailureCode =
  | 'invalid_identity'
  | 'invalid_receipt'
  | 'persistence_failed'

export type TavernChatWorkspaceWritebackReceiptLookupOutcome =
  | {
      readonly status: 'none'
    }
  | {
      readonly status: 'committed'
      readonly receipt: TavernChatWorkspaceWritebackCommittedReceipt
    }
  | {
      readonly status: 'ambiguous'
    }
  | {
      readonly status: 'cancelled'
    }
  | {
      readonly status: 'failed'
      readonly code: TavernChatWorkspaceWritebackReceiptLookupFailureCode
    }

/**
 * Reads durable writeback facts only. Implementations must never recreate or
 * execute the writeback effect when no unique committed receipt is available.
 */
export interface TavernChatWorkspaceWritebackReceiptLookup {
  lookup(
    identity: TavernChatWorkspaceWritebackReceiptLookupIdentity,
    options: { readonly signal: AbortSignal },
  ): Promise<TavernChatWorkspaceWritebackReceiptLookupOutcome>
}
