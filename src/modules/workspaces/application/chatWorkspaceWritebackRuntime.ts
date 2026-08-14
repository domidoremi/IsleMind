import type { AssistantRunId } from '@/core'

export const CHAT_WORKSPACE_WRITEBACK_RECEIPT_SCHEMA =
  'islemind.chat-workspace-writeback-receipt.v1' as const

export const CHAT_WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS = 256
export const CHAT_WORKSPACE_WRITEBACK_IDEMPOTENCY_KEY_MAX_CHARACTERS = 512
export const CHAT_WORKSPACE_WRITEBACK_FINAL_OUTPUT_MAX_CHARACTERS = 262_144
export const CHAT_WORKSPACE_WRITEBACK_REASON_MAX_CHARACTERS = 1_024

export interface ChatWorkspaceWritebackIntent {
  readonly assistantRunId: AssistantRunId
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly workspaceId: string
  readonly expectedAuthorityRevision: number
  readonly idempotencyKey: string
  readonly finalOutput: string
}

export interface ChatWorkspaceWritebackReceiptIdentity {
  readonly schema: typeof CHAT_WORKSPACE_WRITEBACK_RECEIPT_SCHEMA
  readonly assistantRunId: AssistantRunId
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly workspaceId: string
  readonly expectedAuthorityRevision: number
  readonly idempotencyKey: string
}

export type ChatWorkspaceWritebackPortReceipt =
  | (ChatWorkspaceWritebackReceiptIdentity & {
      readonly status: 'applied'
      readonly authorityRevision: number
    })
  | (ChatWorkspaceWritebackReceiptIdentity & {
      readonly status: 'replayed'
      readonly authorityRevision: number
    })
  | (ChatWorkspaceWritebackReceiptIdentity & {
      readonly status: 'no_changes'
      readonly authorityRevision: number
    })
  | (ChatWorkspaceWritebackReceiptIdentity & {
      readonly status: 'conflict'
      readonly actualAuthorityRevision: number
    })
  | (ChatWorkspaceWritebackReceiptIdentity & {
      readonly status: 'cancelled'
    })
  | (ChatWorkspaceWritebackReceiptIdentity & {
      readonly status: 'failed'
      readonly reason?: string
    })

export interface ChatWorkspaceWritebackPort {
  writeback(
    intent: ChatWorkspaceWritebackIntent,
    options: { readonly signal: AbortSignal },
  ): Promise<ChatWorkspaceWritebackPortReceipt>
}

type ForwardedWritebackOutcome<
  TStatus extends ChatWorkspaceWritebackPortReceipt['status'],
> = {
  readonly status: TStatus
  readonly intent: ChatWorkspaceWritebackIntent
  readonly receipt: Extract<ChatWorkspaceWritebackPortReceipt, { readonly status: TStatus }>
}

export type ChatWorkspaceWritebackOutcome =
  | ForwardedWritebackOutcome<'applied'>
  | ForwardedWritebackOutcome<'replayed'>
  | ForwardedWritebackOutcome<'no_changes'>
  | ForwardedWritebackOutcome<'conflict'>
  | (ForwardedWritebackOutcome<'cancelled'> & {
      readonly code: 'port_cancelled'
    })
  | (ForwardedWritebackOutcome<'failed'> & {
      readonly code: 'port_failed'
    })
  | {
      readonly status: 'cancelled'
      readonly code: 'cancelled_before_io' | 'cancelled_after_io'
      readonly intent: ChatWorkspaceWritebackIntent
    }
  | {
      readonly status: 'failed'
      readonly code: 'invalid_intent' | 'port_threw' | 'invalid_receipt'
      readonly intent: ChatWorkspaceWritebackIntent
    }

export interface ChatWorkspaceWritebackRuntime {
  writeback(
    intent: ChatWorkspaceWritebackIntent,
    options: { readonly signal: AbortSignal },
  ): Promise<ChatWorkspaceWritebackOutcome>
}

export interface ChatWorkspaceWritebackRuntimeDependencies {
  readonly port: ChatWorkspaceWritebackPort
}

export function createChatWorkspaceWritebackRuntime(
  dependencies: ChatWorkspaceWritebackRuntimeDependencies,
): ChatWorkspaceWritebackRuntime {
  return {
    async writeback(intent, options) {
      if (options.signal.aborted) {
        return { status: 'cancelled', code: 'cancelled_before_io', intent }
      }
      if (!isValidIntent(intent)) {
        return { status: 'failed', code: 'invalid_intent', intent }
      }

      let candidate: unknown
      try {
        candidate = await dependencies.port.writeback(intent, options)
      } catch {
        if (options.signal.aborted) {
          return { status: 'cancelled', code: 'cancelled_after_io', intent }
        }
        return { status: 'failed', code: 'port_threw', intent }
      }

      let receipt: ChatWorkspaceWritebackPortReceipt
      try {
        if (!isReceiptForIntent(candidate, intent)) {
          return { status: 'failed', code: 'invalid_receipt', intent }
        }
        receipt = candidate
      } catch {
        return { status: 'failed', code: 'invalid_receipt', intent }
      }

      if (
        options.signal.aborted
        && receipt.status !== 'applied'
        && receipt.status !== 'replayed'
        && receipt.status !== 'no_changes'
      ) {
        return { status: 'cancelled', code: 'cancelled_after_io', intent }
      }

      switch (receipt.status) {
        case 'applied':
          return { status: receipt.status, intent, receipt }
        case 'replayed':
          return { status: receipt.status, intent, receipt }
        case 'no_changes':
          return { status: receipt.status, intent, receipt }
        case 'conflict':
          return { status: receipt.status, intent, receipt }
        case 'cancelled':
          return { status: receipt.status, code: 'port_cancelled', intent, receipt }
        case 'failed':
          return { status: receipt.status, code: 'port_failed', intent, receipt }
      }
    },
  }
}

function isValidIntent(intent: ChatWorkspaceWritebackIntent): boolean {
  return isBoundedIdentity(intent.assistantRunId, CHAT_WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS)
    && isBoundedIdentity(intent.conversationId, CHAT_WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS)
    && isBoundedIdentity(intent.assistantMessageId, CHAT_WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS)
    && isBoundedIdentity(intent.workspaceId, CHAT_WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS)
    && isNonNegativeSafeInteger(intent.expectedAuthorityRevision)
    && isBoundedIdentity(
      intent.idempotencyKey,
      CHAT_WORKSPACE_WRITEBACK_IDEMPOTENCY_KEY_MAX_CHARACTERS,
    )
    && typeof intent.finalOutput === 'string'
    && intent.finalOutput.length <= CHAT_WORKSPACE_WRITEBACK_FINAL_OUTPUT_MAX_CHARACTERS
}

function isReceiptForIntent(
  candidate: unknown,
  intent: ChatWorkspaceWritebackIntent,
): candidate is ChatWorkspaceWritebackPortReceipt {
  if (!isRecord(candidate)) return false
  if (
    candidate.schema !== CHAT_WORKSPACE_WRITEBACK_RECEIPT_SCHEMA
    || candidate.assistantRunId !== intent.assistantRunId
    || candidate.conversationId !== intent.conversationId
    || candidate.assistantMessageId !== intent.assistantMessageId
    || candidate.workspaceId !== intent.workspaceId
    || candidate.expectedAuthorityRevision !== intent.expectedAuthorityRevision
    || candidate.idempotencyKey !== intent.idempotencyKey
  ) {
    return false
  }

  switch (candidate.status) {
    case 'applied':
    case 'replayed':
      return isNonNegativeSafeInteger(candidate.authorityRevision)
        && candidate.authorityRevision > intent.expectedAuthorityRevision
    case 'no_changes':
      return candidate.authorityRevision === intent.expectedAuthorityRevision
    case 'conflict':
      return isNonNegativeSafeInteger(candidate.actualAuthorityRevision)
        && candidate.actualAuthorityRevision !== intent.expectedAuthorityRevision
    case 'cancelled':
      return true
    case 'failed':
      return candidate.reason === undefined
        || isBoundedIdentity(candidate.reason, CHAT_WORKSPACE_WRITEBACK_REASON_MAX_CHARACTERS)
    default:
      return false
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBoundedIdentity(value: unknown, maximumCharacters: number): value is string {
  return typeof value === 'string'
    && value.length <= maximumCharacters
    && value.trim().length > 0
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
