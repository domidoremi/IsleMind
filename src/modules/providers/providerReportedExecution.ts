import type { ReportedProviderExecution } from '@/core'

/** Read explicit response metadata only; route names and model catalogs are not execution evidence. */
export function extractReportedProviderExecution(value: unknown): ReportedProviderExecution | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const payload = value as Record<string, unknown>
  const response = record(payload.response) ?? payload
  if (safeModel(response.model)) return { model: response.model, source: 'response.model' }
  if (safeModel(response.modelVersion)) return { model: response.modelVersion, source: 'response.modelVersion' }
  const message = record(response.message)
  if (message && safeModel(message.model)) return { model: message.model, source: 'response.message.model' }
  return undefined
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function safeModel(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 240
    && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value)
}
