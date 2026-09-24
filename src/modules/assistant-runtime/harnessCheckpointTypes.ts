import type { ChatRequest } from '@/core'
import type { HarnessPauseReason } from './harnessPauseReason'

/** A completed receipt is part of request; a tool replay is never recovery. */
export interface HarnessCheckpoint {
  readonly schema: 'islemind.harness-checkpoint.v1'
  readonly request: ChatRequest
  readonly requestHash: string
  readonly capabilityRevision: string
  readonly stepIndex: number
  readonly outputText: string
  readonly streamEventCount: number
  readonly phase: 'ready' | 'provider' | 'operation' | 'confirmation' | 'complete'
  readonly effectCertainty: 'none' | 'settled' | 'uncertain'
  readonly recovery: 'resumable' | 'reconciliation-required'
  readonly requiresOperationSession: boolean
  readonly steering: readonly { readonly id: string; readonly text: string; readonly createdAt: number }[]
  readonly waitingReason?: HarnessPauseReason
}
