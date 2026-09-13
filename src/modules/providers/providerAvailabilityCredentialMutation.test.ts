import { createProviderCredentialStorage } from './providerCredentialStorage'

describe('availability invalidation at the existing secure credential boundary', () => {
  it('fences changed credentials, not repeated discovery writes, and never exposes key values to the hook', async () => {
    const values = new Map<string, string>()
    const events: string[] = []
    const storage = createProviderCredentialStorage({
      getItem: async (key) => values.get(key) ?? null,
      setItem: async (key, value) => { events.push('write'); values.set(key, value) },
      removeItem: async (key) => { events.push('delete'); values.delete(key) },
    }, { async withMutation(ids, mutate) { events.push(`invalidate:${ids.join(',')}`); await mutate(); events.push('release') } })
    await storage.setProviderCredential('p', 'test-key')
    expect(events).toEqual(['invalidate:p', 'write', 'release'])
    events.length = 0
    await storage.applyMutations([{ providerId: 'p', credential: 'test-key' }])
    expect(events).toEqual(['write'])
    events.length = 0
    await storage.applyMutations([{ providerId: 'p', groupId: 'default', credential: 'test-group' }])
    expect(events).toEqual(['invalidate:p', 'write', 'release'])
  })

  it('does not write a credential if durable invalidation failed', async () => {
    let writes = 0
    const storage = createProviderCredentialStorage({ getItem: async () => 'old-test-key',
      setItem: async () => { writes++ }, removeItem: async () => { writes++ },
    }, { async withMutation() { throw new Error('Storage unavailable') } })
    await expect(storage.setProviderCredential('p', 'new-test-key')).rejects.toThrow('Storage unavailable')
    expect(writes).toBe(0)
  })
})
