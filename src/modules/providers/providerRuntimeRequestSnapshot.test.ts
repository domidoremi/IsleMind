import { snapshotProviderRuntimeRequest } from './providerRuntimeRequestSnapshot'
import type { ProviderRuntimeChatRequest } from './providerRuntimeContracts'

function fixture(): ProviderRuntimeChatRequest {
  const provider: ProviderRuntimeChatRequest['provider'] = {
    id: 'snapshot', name: 'Snapshot', type: 'openai', enabled: true, models: ['one'], apiKey: 'fixture-only',
  }
  return { provider, model: 'one', messages: [{ role: 'user', content: 'original' }],
    generationParameterSources: {}, fallbackProviders: [provider],
    settings: { upstreamMaxRetries: 1, modelBlocklist: [] }, signal: new AbortController().signal }
}

it('detaches and freezes plain request data while retaining original ports and shared data identities', () => {
  const source = fixture()
  source.confirmFallback = jest.fn(async () => true)
  source.onExecutionTarget = jest.fn(async () => undefined)
  source.onExecutionFailure = jest.fn()
  const request = snapshotProviderRuntimeRequest(source)
  expect(request.signal).toBe(source.signal)
  expect(request.confirmFallback).toBe(source.confirmFallback)
  expect(request.onExecutionTarget).toBe(source.onExecutionTarget)
  expect(request.onExecutionFailure).toBe(source.onExecutionFailure)
  expect(request.provider).toBe(request.fallbackProviders![0])
  expect(request.provider).not.toBe(source.provider)
  expect(Object.isFrozen(request.provider)).toBe(true)
  expect(Object.isFrozen(request.messages)).toBe(true)
  source.provider.name = 'later'
  source.messages[0].content = 'later'
  source.settings!.upstreamMaxRetries = 99
  expect(request.provider.name).toBe('Snapshot')
  expect(request.messages[0].content).toBe('original')
  expect(request.settings!.upstreamMaxRetries).toBe(1)
  request.provider = { ...request.provider, name: 'runtime-only health projection' }
  expect(source.provider.name).toBe('later')
})

it('repeated boundary snapshots retain the original caller access-revocation port', () => {
  const source = fixture()
  const first = snapshotProviderRuntimeRequest(source)
  const next = snapshotProviderRuntimeRequest({ ...first, settings: { upstreamMaxRetries: 0 } })
  source.settings = { modelBlocklist: ['one'], upstreamMaxRetries: 99 }
  expect(first.settings!.modelBlocklist).toEqual([])
  expect(next.readCurrentAccessSettings!()).toBe(source.settings)
  expect(next.settings!.upstreamMaxRetries).toBe(0)
})

it.each(['policy', 'fallback', 'credential-pin', 'continuation'] as const)(
  'later %s drift revokes the captured selection policy without modifying execution data',
  (kind) => {
    const source = fixture()
    source.failoverPolicy = { mode: 'same-provider' }
    const request = snapshotProviderRuntimeRequest(source)
    expect(request.isSelectionPolicyCurrent!()).toBe(true)
    if (kind === 'policy') source.failoverPolicy = { mode: 'auto-safe', approvedProviderIds: ['later'] }
    else if (kind === 'fallback') source.allowFallback = true
    else if (kind === 'credential-pin') source.targetCredentialGroupId = 'later'
    else source.previousResponseId = 'new-route-bound-state'
    expect(request.isSelectionPolicyCurrent!()).toBe(false)
    expect(request.failoverPolicy).toEqual({ mode: 'same-provider' })
    expect(request.previousResponseId).toBeUndefined()
  },
)

it('intersects earlier safety ports without taking a whole-input behavior snapshot', () => {
  const source = fixture()
  let current = source.settings
  let permitted = true
  source.readCurrentAccessSettings = () => current
  source.isSelectionPolicyCurrent = () => permitted
  const request = snapshotProviderRuntimeRequest(source)
  const next = snapshotProviderRuntimeRequest(request)
  current = { modelBlocklist: ['one'] }
  permitted = false
  expect(next.readCurrentAccessSettings!()).toBe(current)
  expect(next.isSelectionPolicyCurrent!()).toBe(false)
})

it('rejects behavior nested in execution data rather than cloning controller or adapter ownership', () => {
  const source = fixture()
  source.providerToolDeclarations = [{ run: () => undefined }]
  expect(() => snapshotProviderRuntimeRequest(source)).toThrow('plain data')
})
