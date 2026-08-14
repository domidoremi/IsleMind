import type { AIProvider } from '@/types/providerContracts'
import {
  PROVIDER_COMPATIBILITY_EVIDENCE,
  getProviderCompatibilityEvidenceForProvider,
  providerCompatibilityCapabilityCanBeSentForProvider,
  resolveProviderCompatibilityCapabilityStatus,
  resolveProviderCompatibilityEvidenceId,
  type ProviderCompatibilityEvidenceId,
} from './providerCompatibilityCatalog'

export type ProviderRequestCompatibilityCapability =
  | 'vision'
  | 'files'
  | 'tools'
  | 'structuredOutput'
  | 'nativeSearch'

export type ProviderRequestCompatibilityStatus =
  | 'supported'
  | 'partial'
  | 'requiresLiveKey'
  | 'docsChanged'
  | 'unsupported'

export interface ProviderRequestCompatibilityEvidence {
  id: ProviderCompatibilityEvidenceId
  auditState: 'conformance-ready' | 'docs-mapped' | 'needs-live-smoke' | 'protocol-reference'
  capabilityStatus(capability: ProviderRequestCompatibilityCapability): ProviderRequestCompatibilityStatus
}

export interface ProviderRequestCompatibilityPolicyDependencies {
  resolveEvidence(provider: AIProvider): ProviderRequestCompatibilityEvidence
  capabilityCanBeSent(
    provider: AIProvider,
    capability: ProviderRequestCompatibilityCapability,
    explicitDeclaration: boolean,
  ): boolean
}

export interface ProviderRequestCompatibilityCatalogEntry {
  auditState: ProviderRequestCompatibilityEvidence['auditState']
  capabilities: readonly ProviderRequestCompatibilityCapability[]
  statusOverrides?: Partial<Record<ProviderRequestCompatibilityCapability, ProviderRequestCompatibilityStatus>>
}

const ALL_REQUEST_CAPABILITIES = [
  'vision',
  'files',
  'tools',
  'structuredOutput',
  'nativeSearch',
] as const satisfies readonly ProviderRequestCompatibilityCapability[]

/** Request-scoped projection of the canonical provider catalog. */
export const PROVIDER_REQUEST_COMPATIBILITY_CATALOG = Object.fromEntries(
  (Object.keys(PROVIDER_COMPATIBILITY_EVIDENCE) as ProviderCompatibilityEvidenceId[]).map((id) => {
    const evidence = PROVIDER_COMPATIBILITY_EVIDENCE[id]
    const capabilities = ALL_REQUEST_CAPABILITIES.filter((capability) =>
      evidence.behaviorDocs.includes(capability),
    )
    const statusOverrides = Object.fromEntries(
      ALL_REQUEST_CAPABILITIES.flatMap((capability) => {
        const status = evidence.behaviorStatusOverrides?.[capability]
        return status ? [[capability, status] as const] : []
      }),
    )
    return [id, {
      auditState: evidence.auditState,
      capabilities,
      ...(Object.keys(statusOverrides).length > 0 ? { statusOverrides } : {}),
    }]
  }),
) as unknown as Record<ProviderCompatibilityEvidenceId, ProviderRequestCompatibilityCatalogEntry>

export function resolveProviderRequestCompatibilityId(provider: Pick<
  AIProvider,
  'id' | 'type' | 'presetId' | 'detectedPresetId' | 'wireProtocol'
>): ProviderCompatibilityEvidenceId {
  return resolveProviderCompatibilityEvidenceId(provider)
}

export function resolveProviderRequestCompatibilityEvidence(provider: AIProvider): ProviderRequestCompatibilityEvidence {
  const evidence = getProviderCompatibilityEvidenceForProvider(provider)
  return {
    id: evidence.id,
    auditState: evidence.auditState,
    capabilityStatus(capability) {
      return resolveProviderRequestCompatibilityStatus(evidence.id, capability)
    },
  }
}

export function resolveProviderRequestCompatibilityStatus(
  id: ProviderCompatibilityEvidenceId,
  capability: ProviderRequestCompatibilityCapability,
): ProviderRequestCompatibilityStatus {
  return resolveProviderCompatibilityCapabilityStatus(id, capability)
}

export function providerRequestCompatibilityCapabilityCanBeSent(
  provider: AIProvider,
  capability: ProviderRequestCompatibilityCapability,
  explicitDeclaration: boolean,
): boolean {
  return providerCompatibilityCapabilityCanBeSentForProvider(provider, capability, explicitDeclaration)
}

/** Projects compatibility evidence into the request-admission surface used by wire-shaping policies. */
export function createProviderRequestCompatibilityPolicy(
  dependencies: ProviderRequestCompatibilityPolicyDependencies,
) {
  return {
    capabilityCanBeSent(
      provider: AIProvider,
      capability: ProviderRequestCompatibilityCapability,
      explicitDeclaration: boolean,
    ): boolean {
      return dependencies.capabilityCanBeSent(provider, capability, explicitDeclaration)
    },
    capabilityStatus(
      provider: AIProvider,
      capability: ProviderRequestCompatibilityCapability,
    ): ProviderRequestCompatibilityStatus {
      return dependencies.resolveEvidence(provider).capabilityStatus(capability)
    },
    usesProtocolReferenceEvidence(provider: AIProvider): boolean {
      return dependencies.resolveEvidence(provider).auditState === 'protocol-reference'
    },
  }
}
