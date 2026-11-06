import { isUsageExecutionIdentity } from '@/core'
import type { MessageUsageExecution } from '@/types/chatContracts'

export const MAX_MESSAGE_USAGE_REQUESTS = 128

export function normalizeMessageUsageExecution(value: unknown): MessageUsageExecution | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const reference = value as Record<string, unknown>
  if (reference.schema !== 'islemind.message-usage-reference.v1'
    || !isUsageExecutionIdentity(reference.responseExecutionId)
    || !Array.isArray(reference.requestIds) || reference.requestIds.length > MAX_MESSAGE_USAGE_REQUESTS
    || !reference.requestIds.every(isUsageExecutionIdentity)
    || new Set(reference.requestIds).size !== reference.requestIds.length
    || Object.keys(reference).some(key => !['schema', 'responseExecutionId', 'requestIds'].includes(key))) return undefined
  return {
    schema: 'islemind.message-usage-reference.v1',
    responseExecutionId: reference.responseExecutionId,
    requestIds: [...reference.requestIds],
  }
}

export function linkMessageUsageRequest(
  current: unknown,
  responseExecutionId: string,
  logicalRequestId: string,
): MessageUsageExecution | undefined {
  if (!isUsageExecutionIdentity(responseExecutionId) || !isUsageExecutionIdentity(logicalRequestId)) return undefined
  const previous = normalizeMessageUsageExecution(current)
  if (previous && previous.responseExecutionId !== responseExecutionId) return undefined
  const requestIds = previous?.requestIds ?? []
  return {
    schema: 'islemind.message-usage-reference.v1',
    responseExecutionId,
    requestIds: requestIds.includes(logicalRequestId) || requestIds.length >= MAX_MESSAGE_USAGE_REQUESTS
      ? requestIds : [...requestIds, logicalRequestId],
  }
}
