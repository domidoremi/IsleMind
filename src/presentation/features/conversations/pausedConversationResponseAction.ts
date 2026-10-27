import type { Message } from '@/types/chatContracts'

export interface PausedConversationResponseIdentity {
  readonly runId: string
  readonly journalSequence: number
}

/** A disposable UI identity, not permission to resume or repeat an operation. */
export function getPausedConversationResponseAction(message: Message): PausedConversationResponseIdentity | undefined {
  const lifecycle = message.responseLifecycle
  if (message.role !== 'assistant' || (message.status !== 'streaming' && message.status !== 'sending')
    || lifecycle?.stage !== 'paused' || lifecycle.completedAt !== undefined) return undefined
  const entry = lifecycle.history.at(-1)
  if (entry?.stage !== 'paused' || entry.completedAt !== undefined || entry.startedAt !== lifecycle.stageStartedAt) return undefined
  const match = /^harness-pause-v1:(.+):(\d+)$/.exec(entry.traceId ?? '')
  if (!match) return undefined
  const journalSequence = Number(match[2])
  if (!Number.isSafeInteger(journalSequence) || journalSequence < 1) return undefined
  return { runId: match[1], journalSequence }
}
