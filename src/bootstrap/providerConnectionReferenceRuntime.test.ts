import type { ProviderConnectionReference } from '@/core'
import { createProviderConnectionReferenceRuntime, PROVIDER_CONNECTION_REFERENCES_CHANGED, type ProviderConnectionReferenceSnapshot } from './providerConnectionReferenceRuntime'

const reference = (id: string, kind: ProviderConnectionReference['kind'] = 'conversation'): ProviderConnectionReference => ({
  kind, id, label: id, targets: [{ providerId: 'A', model: 'Alias', role: 'model' }],
})
function fixture() {
  const snapshot: ProviderConnectionReferenceSnapshot = {
    settingsReferences: [reference('route', 'routing')], localReferences: [reference('local'), { ...reference('draft'), draft: true }],
    localSaved: 1, localDrafts: 1, localUnreadable: 0, localIds: ['local', 'draft'],
  }
  const reader = { readProviderReferences: jest.fn(async () => ({ references: [reference('older')], inspected: 2, remaining: 3, unreadable: 1 })) }
  return { snapshot, reader, runtime: createProviderConnectionReferenceRuntime({ capture: () => snapshot, reader, now: () => 123 }) }
}

it('combines local overrides, unsent drafts and older metadata with explicit coverage and frozen output', async () => {
  const { snapshot, reader, runtime } = fixture()
  const report = await runtime.load(['A', 'A'])
  expect(reader.readProviderReferences).toHaveBeenCalledWith({ providerIds: ['A'], excludeConversationIds: ['local', 'draft'] })
  expect(report.groups.find(group => group.kind === 'conversation')?.total).toBe(3)
  expect(report.conversations).toEqual({ savedInspected: 3, savedRemaining: 3, unreadable: 1, localDrafts: 1 })
  expect(report.capturedAt).toBe(123)
  snapshot.localReferences[0].targets[0].model = 'changed-later'
  expect(report.groups[0].items[0].targets[0].model).toBe('Alias')
  expect(Object.isFrozen(report)).toBe(true)
  expect(Object.isFrozen(report.groups[0].items[0].targets)).toBe(true)
})

it('rejects changed configuration during the asynchronous read rather than mixing two reports', async () => {
  const { snapshot, reader, runtime } = fixture()
  reader.readProviderReferences.mockImplementationOnce(async () => {
    snapshot.settingsReferences.push(reference('new-scene', 'scene'))
    return { references: [], inspected: 0, remaining: 0, unreadable: 0 }
  })
  await expect(runtime.load(['A'])).rejects.toThrow(PROVIDER_CONNECTION_REFERENCES_CHANGED)
})

it('honors cancellation before and after the bounded read without a replacement empty report', async () => {
  const { runtime, reader } = fixture()
  const before = new AbortController(); before.abort()
  await expect(runtime.load(['A'], before.signal)).rejects.toThrow('cancelled')
  expect(reader.readProviderReferences).not.toHaveBeenCalled()
  const during = new AbortController()
  reader.readProviderReferences.mockImplementationOnce(async () => {
    during.abort(); return { references: [], inspected: 0, remaining: 0, unreadable: 0 }
  })
  await expect(runtime.load(['A'], during.signal)).rejects.toThrow('cancelled')
})

it('preserves exact counts when navigation items exceed the display budget and strips extraneous fields', async () => {
  const { snapshot, runtime } = fixture()
  snapshot.settingsReferences = Array.from({ length: 40 }, (_, index) => ({ ...reference(`route-${index}`, 'routing'),
    permission: 'forbidden', targets: [{ providerId: 'A', model: 'Alias', role: 'primary', apiKey: 'forbidden' }] } as unknown as ProviderConnectionReference))
  const report = await runtime.load(['A'])
  const routes = report.groups.find(group => group.kind === 'routing')!
  expect(routes.total).toBe(40)
  expect(routes.items).toHaveLength(25)
  expect(routes.truncated).toBe(true)
  expect(JSON.stringify(report)).not.toContain('forbidden')
})
