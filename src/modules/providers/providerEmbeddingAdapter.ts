import type { AIProvider } from '@/types/providerContracts'
import { ProviderHttpError } from './providerOperationResult'
import { safeProviderResponseText } from './providerTransportUtils'

export interface ProviderEmbeddingResult {
  embedding: number[]
  source: 'provider'
  model: string
}

export interface ProviderEmbeddingOptions {
  signal?: AbortSignal
}

export interface ProviderEmbeddingAdapterDependencies {
  request(input: RequestInfo | URL, init: RequestInit | undefined, timeoutMs: number): Promise<Response>
  timeoutMs: number
  supportsEmbeddings(provider: AIProvider): boolean
  configurationIssue(provider: AIProvider): string | undefined
  resolveBaseUrl(provider: AIProvider): string
  resolveHeaders(provider: AIProvider): Record<string, string>
}

export interface ProviderEmbeddingAdapter {
  embed(
    provider: AIProvider,
    text: string,
    options?: ProviderEmbeddingOptions,
  ): Promise<ProviderEmbeddingResult>
}

/** Owns provider embedding validation, wire payload, cancellation, and response parsing. */
export function createProviderEmbeddingAdapter(
  dependencies: ProviderEmbeddingAdapterDependencies,
): ProviderEmbeddingAdapter {
  return {
    async embed(provider, text, options = {}) {
      if (!provider.apiKey.trim()) throw new Error('missing_key')
      if (!text.trim()) throw new Error('empty_text')
      if (!isOpenAICompatibleEmbeddingProvider(provider)) {
        throw new Error('embeddings_endpoint_unavailable')
      }
      if (!dependencies.supportsEmbeddings(provider)) {
        throw new Error('embeddings_unsupported_by_contract')
      }
      const issue = dependencies.configurationIssue(provider)
      if (issue) throw new Error(issue)

      const model = resolveProviderEmbeddingModel(provider)
      const response = await dependencies.request(
        `${trimTrailingSlash(dependencies.resolveBaseUrl(provider))}/embeddings`,
        {
          method: 'POST',
          headers: dependencies.resolveHeaders(provider),
          body: JSON.stringify({
            model,
            input: text.slice(0, 8000),
          }),
          ...(options.signal ? { signal: options.signal } : {}),
        },
        dependencies.timeoutMs,
      )
      if (!response.ok) {
        throw new ProviderHttpError(response.status, await safeProviderResponseText(response))
      }
      const json = await response.json() as { data?: Array<{ embedding?: unknown }> }
      const embedding = json.data?.[0]?.embedding
      if (!Array.isArray(embedding)) throw new Error('empty_embedding')
      return {
        embedding: embedding.filter((value): value is number => typeof value === 'number'),
        source: 'provider',
        model,
      }
    },
  }
}

export function resolveProviderEmbeddingModel(provider: AIProvider): string {
  if (provider.type === 'openai') return 'text-embedding-3-small'
  const configured = provider.models.find((model) => /embed|embedding|text-embedding|(?:^|[/_-])bge(?:[/_-]|$)|(?:^|[/_-])e5(?:[/_-]|$)|(?:^|[/_-])gte(?:[/_-]|$)/i.test(model))
  if (configured) return configured
  if (provider.type === 'xiaomi-mimo') return 'text-embedding'
  return 'text-embedding-3-small'
}

function isOpenAICompatibleEmbeddingProvider(provider: AIProvider): boolean {
  return provider.type === 'openai'
    || provider.type === 'openai-compatible'
    || provider.type === 'xiaomi-mimo'
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}
