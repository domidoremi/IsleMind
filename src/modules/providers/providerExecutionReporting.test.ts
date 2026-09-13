import { reportProviderExecutionTarget } from './providerExecutionTarget'
import { providerForRuntimeFallback, routeForRuntimeFallback } from './providerRuntimeFallback'
import { chooseCredentialForModel } from './providerCredentialGroups'
import type { AIProvider } from '@/types/providerContracts'

const provider: AIProvider = {
  id: 'p', name: 'Provider', type: 'openai', enabled: true, models: ['upstream'], apiKey: 'fixture-primary',
  credentialGroups: [{ id: 'default', enabled: true, label: 'Real group', apiKey: 'fixture-group' }],
}

describe('out-of-band actual execution reporting', () => {
  const identity = { providerId: 'p', model: 'upstream', credentialSource: { kind: 'primary' as const }, protocolAdapterId: 'openai-chat' as const, endpointVariant: 'direct' }

  it('awaits the observer before dispatch and copies only secret-free identity fields', async () => {
    let release!: () => void
    const barrier = new Promise<void>((resolve) => { release = resolve })
    const events: string[] = []
    const targets: unknown[] = []
    const execution = reportProviderExecutionTarget({ ...identity, apiKey: 'not-an-identity-field' } as typeof identity, new AbortController().signal, async (target) => {
      events.push('target')
      targets.push(target)
      await barrier
    }).then(() => events.push('dispatch'))
    await Promise.resolve()
    expect(events).toEqual(['target'])
    release()
    await execution
    expect(events).toEqual(['target', 'dispatch'])
    expect(targets[0]).toMatchObject(identity)
    expect(JSON.stringify(targets)).not.toContain('not-an-identity-field')
  })

  it('does not dispatch after cancellation during an observer, or after an observer failure', async () => {
    const controller = new AbortController()
    await expect(reportProviderExecutionTarget(identity, controller.signal, async () => { controller.abort() })).rejects.toMatchObject({ name: 'AbortError' })
    const observer = jest.fn()
    await expect(reportProviderExecutionTarget(identity, controller.signal, observer)).rejects.toMatchObject({ name: 'AbortError' })
    expect(observer).not.toHaveBeenCalled()
    await expect(reportProviderExecutionTarget(identity, new AbortController().signal, async () => { throw new Error('durability failed') })).rejects.toMatchObject({ name: 'ProviderExecutionTargetObserverError', cause: new Error('durability failed') })
  })

  it('keeps primary distinct from a real default group and never borrows another provider key', () => {
    const request = { provider, model: 'upstream' }
    const primary = providerForRuntimeFallback(request, { providerId: 'p', model: 'upstream', credentialSource: { kind: 'primary' } })
    const group = providerForRuntimeFallback(request, { providerId: 'p', model: 'upstream', credentialSource: { kind: 'group', groupId: 'default' } })
    expect(primary.apiKey).toBe('fixture-primary')
    expect(primary.apiKeySource).toEqual({ kind: 'primary' })
    expect(group.apiKey).toBe('fixture-group')
    expect(group.apiKeySource).toEqual({ kind: 'group', groupId: 'default' })
    expect(() => providerForRuntimeFallback(request, { providerId: 'deleted', model: 'upstream' })).toThrow()
    for (const groupId of ['absent', 'empty', 'disabled']) {
      expect(() => providerForRuntimeFallback({ ...request, provider: { ...provider, credentialGroups: [
        ...provider.credentialGroups!, { id: 'empty', enabled: true, label: 'Empty' }, { id: 'disabled', enabled: false, label: 'Disabled', apiKey: 'fixture-disabled' },
      ] } }, { providerId: 'p', model: 'upstream', credentialSource: { kind: 'group', groupId } })).toThrow()
    }
  })

  it('retains hydrated group provenance when automatic selection uses its provider-key projection', () => {
    const hydrated: AIProvider = { ...provider, apiKey: 'fixture-group', apiKeySource: { kind: 'group', groupId: 'default' }, credentialGroups: [] }
    expect(chooseCredentialForModel(hydrated, 'upstream').source).toEqual({ kind: 'group', groupId: 'default' })
    expect(routeForRuntimeFallback({ provider: hydrated, model: 'upstream' }).credentialSource).toEqual({ kind: 'group', groupId: 'default' })
  })
})
