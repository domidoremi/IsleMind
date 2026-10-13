import { measureJsonCharacters, type ChatReasoningReplayPart } from '@/core'
import { buildAssistantRequestHash, isAssistantRequestHash } from './requestIdentity'
import { DEFAULT_MODEL_OPERATION_RECEIPT_OUTPUT_LIMIT, type ModelOperationCall, type ModelOperationReceipt } from './modelOperationTurnRuntime'

export const MAX_MODEL_OPERATION_BATCH_CALLS = 8
export const MODEL_OPERATION_BATCH_JSON_LIMIT = 512 * 1024
const SCHEMA = 'islemind.model-operation-batch.v1' as const

/** Host-owned queue, not a permission token. Exactly one call advances per durable checkpoint. */
export interface ModelOperationBatch {
  readonly schema: typeof SCHEMA
  readonly turnId: string
  readonly startStepIndex: number
  readonly catalogRevision: string
  readonly requestHash: string
  readonly calls: readonly ModelOperationCall[]
  readonly receipts: readonly ModelOperationReceipt[]
  readonly reasoningReplay: readonly ChatReasoningReplayPart[]
  readonly digest: string
}

export function createModelOperationBatch(input: Omit<ModelOperationBatch, 'schema' | 'digest'>): ModelOperationBatch {
  measureJsonCharacters(input, MODEL_OPERATION_BATCH_JSON_LIMIT, 20_000)
  const value = JSON.parse(JSON.stringify({ ...input, schema: SCHEMA }))
  value.digest = buildAssistantRequestHash(value)
  return decodeModelOperationBatch(value)
}

export function decodeModelOperationBatch(input: unknown): ModelOperationBatch {
  measureJsonCharacters(input, MODEL_OPERATION_BATCH_JSON_LIMIT, 20_000)
  const value = JSON.parse(JSON.stringify(input)) as ModelOperationBatch
  if (!value || Object.keys(value).length !== 9 || value.schema !== SCHEMA
    || !identity(value.turnId) || !identity(value.catalogRevision) || !isAssistantRequestHash(value.requestHash)
    || !Number.isSafeInteger(value.startStepIndex) || value.startStepIndex < 0
    || !Array.isArray(value.calls) || value.calls.length < 2 || value.calls.length > MAX_MODEL_OPERATION_BATCH_CALLS
    || !Array.isArray(value.receipts) || value.receipts.length > value.calls.length
    || !Array.isArray(value.reasoningReplay)
    || value.calls.some(call => !call || !identity(call.callId) || !identity(call.operationId)
      || !identity(call.declaredName) || !identity(call.schemaRevision) || call.catalogRevision !== value.catalogRevision
      || !call.arguments || typeof call.arguments !== 'object' || Array.isArray(call.arguments))
    || new Set(value.calls.map(call => call.callId)).size !== value.calls.length
    || value.receipts.some((receipt, index) => !receipt || receipt.schema !== 'islemind.model-operation-receipt.v1'
      || receipt.turnId !== value.turnId || receipt.catalogRevision !== value.catalogRevision
      || receipt.stepIndex !== value.startStepIndex + index || receipt.callId !== value.calls[index].callId
      || receipt.operationId !== value.calls[index].operationId || receipt.terminal !== true
      || !['succeeded', 'failed', 'rejected', 'cancelled'].includes(receipt.status)
      || typeof receipt.code !== 'string' || receipt.code.length > 80
      || typeof receipt.output !== 'string' || receipt.output.length > DEFAULT_MODEL_OPERATION_RECEIPT_OUTPUT_LIMIT)) {
    throw new Error('Invalid model-operation batch checkpoint')
  }
  // Reserve headroom before any dispatch for eight fully escaped receipt texts
  // and the duplicated current call in a protected pending-confirmation record.
  measureJsonCharacters({ calls: value.calls, reasoningReplay: value.reasoningReplay }, 128 * 1024, 16_000)
  const { digest, ...body } = value
  if (digest !== buildAssistantRequestHash(body)) throw new Error('Model-operation batch identity mismatch')
  return deepFreeze(value)
}

export function advanceModelOperationBatch(batch: ModelOperationBatch, receipt: ModelOperationReceipt): ModelOperationBatch {
  const { schema: _schema, digest: _digest, ...body } = batch
  return createModelOperationBatch({ ...body, receipts: [...batch.receipts, receipt] })
}

function identity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 320 && value.trim() === value
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}
