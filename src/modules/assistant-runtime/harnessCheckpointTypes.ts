import type { ChatRequest } from '@/core'
import type { HarnessPauseReason } from './harnessPauseReason'
import type { ModelOperationBatch } from './application/modelOperationBatch'

/** Completed receipts live in request or the bounded queue; replay is never recovery. */
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
  readonly operationBatch?: ModelOperationBatch
  readonly steering: readonly { readonly id: string; readonly text: string; readonly createdAt: number }[]
  readonly waitingReason?: HarnessPauseReason
}
