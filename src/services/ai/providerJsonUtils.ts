import type { AIProvider } from '@/types'
import { st } from '@/i18n/service'
import { ProviderHttpError } from '@/services/ai/providerOperationResult'

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export function parseProviderJson<T>(text: string, response: Response, provider: AIProvider, label: string): T {
  const trimmed = text.trim()
  const contentType = response.headers.get('content-type') ?? ''
  if (!trimmed) {
    throw new ProviderHttpError(response.status || 200, st('providerOperation.jsonEmpty', { label }))
  }
  if (/^</.test(trimmed) || /text\/html/i.test(contentType)) {
    throw new ProviderHttpError(
      response.status || 200,
      st('providerOperation.htmlInsteadJson', { provider: provider.name })
    )
  }
  try {
    return JSON.parse(trimmed) as T
  } catch {
    throw new ProviderHttpError(
      response.status || 200,
      st('providerOperation.invalidJson', { label, contentType: contentType || st('updates.unknown'), snippet: trimmed.slice(0, 180) })
    )
  }
}

export function safeJsonPreview(value: unknown): string {
  try {
    const raw = JSON.stringify(value)
    return raw.length > 360 ? `${raw.slice(0, 360)}...` : raw
  } catch {
    return ''
  }
}

export function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function stringifyReasoningDetails(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value
    .map((item) => {
      if (typeof item === 'string') return item
      if (!item || typeof item !== 'object') return ''
      const record = item as Record<string, unknown>
      return [
        record.text,
        record.reasoning_text,
        record.content,
        record.summary,
      ].map(stringValue).filter(Boolean).join('\n')
    })
    .filter(Boolean)
    .join('\n')
}
