import { projectModelAvailability, credentialSourceLabel, selectModelAvailabilityEvidence } from './modelAvailabilityPresentation'
import type { ProviderModelCurrent } from '@/modules/providers'

const current: ProviderModelCurrent = {
  providerId: 'p', modelId: 'm', credentialSource: { kind: 'primary' }, protocolAdapterId: 'openai-chat',
  endpointVariant: 'direct', scopeId: 's', epoch: 'e', availability: 'available', advertisement: 'present',
  lastAppliedOrder: 1, updatedAt: 10, invalidated: false,
}
const t = ((key: string, values?: Record<string, unknown>) => `${key}${values?.group ? `:${values.group}` : ''}`) as any

describe('availability presentation is evidence, not routing authority', () => {
  it('shows current operational failure separately from historical availability', () => {
    const row: ProviderModelCurrent = { ...current, evidence: { schema: 'islemind.model-availability-evidence.v1', source: 'generation', observedAt: 20,
      evidence: { kind: 'operational', reason: 'server_error' } } }
    expect(projectModelAvailability({ current: row })).toMatchObject({ availability: 'available', labels: ['degraded'], blockedReason: undefined })
    expect(projectModelAvailability({ current: { ...row, invalidated: true } }).labels).toEqual([])
  })
  it('keeps offline and credential status separate from trusted model access', () => {
    expect(projectModelAvailability({ current, offline: true, credentialBlocked: true })).toEqual({
      availability: 'available', advertisement: 'present', labels: ['offline', 'credentialBlocked'], blockedReason: undefined,
    })
  })
  it('does not infer unavailable, retired or supported capabilities from missing or invalidated evidence', () => {
    expect(projectModelAvailability({}).availability).toBe('unknown')
    expect(projectModelAvailability({ current: { ...current, invalidated: true, availability: 'retired' } }).availability).toBe('unknown')
    expect(projectModelAvailability({ current: { ...current, advertisement: 'not-advertised' } }).availability).toBe('available')
  })
  it('blocks known retired/unavailable choices while preserving policy and active-reply constraints', () => {
    expect(projectModelAvailability({ current: { ...current, availability: 'retired' } }).blockedReason).toBe('retired')
    expect(projectModelAvailability({ current: { ...current, availability: 'unavailable' } }).blockedReason).toBe('unavailable')
    expect(projectModelAvailability({ policyBlocked: true }).blockedReason).toBe('policyBlocked')
    expect(projectModelAvailability({ activeReply: true }).blockedReason).toBe('activeReply')
  })
  it('never conflates primary with a real default group', () => {
    expect(credentialSourceLabel({ kind: 'primary' }, undefined, t)).not.toBe(credentialSourceLabel({ kind: 'group', groupId: 'default' }, undefined, t))
  })

  it('does not let a retired credential scope block an available or unobserved automatic alternative', () => {
    const provider = { id: 'p', credentialGroups: [{ id: 'default', label: 'Real default', enabled: true }] }
    const retired = { ...current, credentialSource: { kind: 'group' as const, groupId: 'default' }, availability: 'retired' as const, updatedAt: 20 }
    const input = { provider, modelId: 'm', protocolAdapterId: current.protocolAdapterId, endpointVariant: 'direct' }
    expect(selectModelAvailabilityEvidence({ ...input, rows: [current, retired] })).toBe(current)
    expect(selectModelAvailabilityEvidence({ ...input, rows: [retired] })).toBeUndefined()
    expect(selectModelAvailabilityEvidence({ ...input, rows: [{ ...current, availability: 'retired' }, retired] })?.availability).toBe('retired')
    expect(selectModelAvailabilityEvidence({ ...input, rows: [{ ...current, invalidated: true }, retired] })).toBeUndefined()
    expect(selectModelAvailabilityEvidence({ ...input, rows: [{ ...current, endpointVariant: 'other' }, retired] })).toBeUndefined()
  })
})
