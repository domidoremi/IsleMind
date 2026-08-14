import type { AIProvider } from '@/types/providerContracts'
import { isProviderWireProtocol } from './providerConfigPolicy'
import { isProviderPresetId } from './providerRegistry'

export class ProviderMetadataPersistenceValidationError extends Error {
  constructor() {
    super('Persisted provider metadata record is malformed.')
    this.name = 'ProviderMetadataPersistenceValidationError'
  }
}

export interface ProviderMetadataPersistenceRecordPort {
  read(): Promise<unknown | null>
  write(providers: readonly AIProvider[]): Promise<void>
}

export interface ProviderMetadataPersistencePort {
  load(): Promise<readonly AIProvider[] | null>
  save(providers: readonly AIProvider[]): Promise<void>
}

export function createProviderMetadataPersistence(
  records: ProviderMetadataPersistenceRecordPort,
): ProviderMetadataPersistencePort {
  return Object.freeze({
    async load() {
      const record = await records.read()
      if (record === null) return null
      if (!Array.isArray(record)) {
        throw new ProviderMetadataPersistenceValidationError()
      }
      const migrated = record.map(migrateProviderMetadata)
      if (migrated.some((provider) => provider === null)) {
        throw new ProviderMetadataPersistenceValidationError()
      }
      const providers = migrated as AIProvider[]
      if (providers.some((provider, index) => provider !== record[index])) {
        await records.write(providers)
      }
      return providers
    },
    save(providers: readonly AIProvider[]) {
      return records.write(providers)
    },
  })
}

const legacyCustomPrefix = ['custom', 'openai'].join('-')
const legacyAnthropicPrefix = ['custom', 'anthropic'].join('-')
const legacyCompatibleSuffix = 'compatible'

function migrateProviderMetadata(value: unknown): AIProvider | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const provider = value as Record<string, unknown>
  if (typeof provider.id !== 'string') return null

  const presetId = migrateLegacyPresetId(provider.presetId)
  const detectedPresetId = migrateLegacyPresetId(provider.detectedPresetId)
  if (provider.presetId !== undefined && presetId === undefined) return null
  if (provider.detectedPresetId !== undefined && detectedPresetId === undefined) return null
  if (provider.wireProtocol !== undefined && !isProviderWireProtocol(provider.wireProtocol)) return null

  const changed = presetId !== provider.presetId || detectedPresetId !== provider.detectedPresetId
  if (!changed) return provider as unknown as AIProvider
  const next = {
    ...provider,
    ...(presetId !== undefined ? { presetId } : {}),
    ...(detectedPresetId !== undefined ? { detectedPresetId } : {}),
    wireProtocol: inferLegacyWireProtocol(provider.presetId, provider.detectedPresetId),
  }
  if (!isProviderMetadata(next)) return null
  return next as unknown as AIProvider
}

function migrateLegacyPresetId(value: unknown): unknown {
  if (value === `${legacyCustomPrefix}-${legacyCompatibleSuffix}`) return 'custom-endpoint'
  if (value === `${legacyAnthropicPrefix}-${legacyCompatibleSuffix}`) return 'custom-endpoint'
  if (value === undefined || isProviderPresetId(value)) return value
  return undefined
}

function inferLegacyWireProtocol(...values: unknown[]): 'openai-compatible' | 'anthropic-compatible' {
  return values.includes(`${legacyAnthropicPrefix}-${legacyCompatibleSuffix}`)
    ? 'anthropic-compatible'
    : 'openai-compatible'
}

function isProviderMetadata(value: unknown): value is Record<string, unknown> & { id: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const provider = value as Record<string, unknown>
  return typeof provider.id === 'string'
    && (provider.presetId === undefined || isProviderPresetId(provider.presetId))
    && (provider.detectedPresetId === undefined || isProviderPresetId(provider.detectedPresetId))
    && (provider.wireProtocol === undefined || isProviderWireProtocol(provider.wireProtocol))
}
