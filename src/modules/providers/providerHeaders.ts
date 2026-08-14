import type { AIProvider } from '@/types/providerContracts'
import { isAzureOpenAIProvider } from './providerAzureRouting'
import { isBedrockRuntimeProvider } from './providerAwsBedrockRouting'
import { applyProviderClientSimulationHeaders } from './providerClientSimulationPolicy'
import { providerNativeRemoteCompactEvidenceMatchesProvider } from './providerCompatibilityCatalog'
import { isVertexAIOpenAICompatibleProvider } from './providerHostedBoundaryPolicy'
import { isGitHubModelsProvider } from './providerIdentityPolicy'
import { ANTHROPIC_COMPACTION_BETA } from './providerContextManagementPolicy'

export type ProviderHeaderProtocol = 'openai' | 'anthropic' | 'google'

export interface ProviderHeaderInput {
  protocol: ProviderHeaderProtocol
  apiKey: string
  credentialHeader?: 'authorization' | 'api-key'
  /** Extra Anthropic beta feature headers (comma-joined into anthropic-beta). */
  anthropicBetas?: readonly string[]
}

/** Builds protocol headers without importing provider settings or hosted-route detection. */
export function buildProviderHeaders(input: ProviderHeaderInput): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (input.protocol === 'google') return { ...headers, 'x-goog-api-key': input.apiKey }
  if (input.protocol === 'anthropic') {
    const base = input.credentialHeader === 'authorization'
      ? { ...headers, Authorization: `Bearer ${input.apiKey}`, 'anthropic-version': '2023-06-01' }
      : { ...headers, 'x-api-key': input.apiKey, 'anthropic-version': '2023-06-01' }
    if (input.anthropicBetas?.length) {
      return { ...base, 'anthropic-beta': input.anthropicBetas.join(',') }
    }
    return base
  }
  return input.credentialHeader === 'api-key'
    ? { ...headers, 'api-key': input.apiKey }
    : { ...headers, Authorization: `Bearer ${input.apiKey}` }
}

/**
 * GitHub recommends its JSON media type and the current conservative REST API
 * version for catalog requests. These fields do not replace Bearer auth.
 * https://docs.github.com/en/rest/models/catalog
 * https://docs.github.com/en/rest/about-the-rest-api/api-versions
 */
export function getGitHubModelsApiHeaders(): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

export interface GetProviderRequestHeadersOptions {
  /** When true and provider is Anthropic Messages, attach compact-2026-01-12 beta. */
  remoteCompactEligible?: boolean
  /** Accepted for request-call compatibility; stable client identity is provider-scoped. */
  model?: string
  /** Explicit OAuth admission. API-key callers must leave this unset. */
  authentication?: 'api-key' | 'oauth'
}

/** Resolves request headers for a configured provider without a legacy service facade. */
export function getProviderRequestHeaders(
  provider: AIProvider,
  options: GetProviderRequestHeadersOptions = {},
): Record<string, string> {
  const anthropicBetas =
    options.remoteCompactEligible &&
    provider.type === 'anthropic' &&
    provider.wireProtocol === undefined &&
    provider.capabilities?.remoteCompact === true &&
    providerNativeRemoteCompactEvidenceMatchesProvider(provider)
      ? [ANTHROPIC_COMPACTION_BETA]
      : undefined

  let headers: Record<string, string>
  switch (provider.type) {
    case 'openai':
      headers = buildProviderHeaders({ protocol: 'openai', apiKey: provider.apiKey })
      break
    case 'anthropic':
      headers = buildProviderHeaders({
        protocol: 'anthropic',
        apiKey: provider.apiKey,
        anthropicBetas,
      })
      break
    case 'google':
      headers = buildProviderHeaders({ protocol: 'google', apiKey: provider.apiKey })
      break
    case 'openai-compatible':
      if (isAzureOpenAIProvider(provider)) {
        headers = buildProviderHeaders({ protocol: 'openai', apiKey: provider.apiKey, credentialHeader: 'api-key' })
      } else if (isVertexAIOpenAICompatibleProvider(provider)) {
        headers = buildProviderHeaders({ protocol: 'openai', apiKey: provider.apiKey })
      } else if (provider.wireProtocol === 'anthropic-compatible') {
        headers = buildProviderHeaders({
          protocol: 'anthropic',
          apiKey: provider.apiKey,
          credentialHeader: 'authorization',
          anthropicBetas,
        })
      } else {
        headers = buildProviderHeaders({ protocol: 'openai', apiKey: provider.apiKey })
      }
      break
    case 'xiaomi-mimo':
      headers = provider.wireProtocol === 'anthropic-compatible'
        ? buildProviderHeaders({
          protocol: 'anthropic',
          apiKey: provider.apiKey,
          credentialHeader: 'authorization',
          anthropicBetas,
        })
        : buildProviderHeaders({ protocol: 'openai', apiKey: provider.apiKey })
      break
  }

  // Direct Bedrock Runtime creates its final header set inside SigV4 signing.
  // Do not add an unsigned compatibility header after canonicalization.
  if (isBedrockRuntimeProvider(provider)) return headers
  const documentedHeaders = isGitHubModelsProvider(provider)
    ? { ...headers, ...getGitHubModelsApiHeaders() }
    : headers
  // React Native native transports can send this policy. Browser fetch may
  // replace or reject User-Agent, so web callers must not claim wire equality.
  return applyProviderClientSimulationHeaders(documentedHeaders, {
    provider,
    model: options.model,
    authentication: options.authentication,
  })
}
