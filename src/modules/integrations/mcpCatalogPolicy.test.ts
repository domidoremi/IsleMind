import { createMcpCatalogPolicy, type McpCatalogDiscovery, type McpCatalogServer } from './mcpCatalogPolicy'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}

function server(id = 'remote'): McpCatalogServer {
  return {
    id, name: id, url: `https://example.invalid/${id}`, transport: 'streamable-http',
    enabled: true, status: 'disconnected', manifestTtlMs: 60000,
    tools: [], resources: [], prompts: [], approvedToolNames: [], createdAt: 10, updatedAt: 10,
  }
}

function fixture(initial = [server()]) {
  let saved = initial
  const write = jest.fn(async (next: readonly McpCatalogServer[]) => { saved = [...next] })
  const discover = jest.fn(async (_value: McpCatalogServer): Promise<McpCatalogDiscovery> => ({
    tools: [], resources: [], prompts: [],
  }))
  const invalidate = jest.fn()
  const catalog = createMcpCatalogPolicy({
    builtinServerId: 'builtin',
    loadServers: async () => saved,
    saveServers: (next) => write(next),
    builtinServer: () => ({ ...server('builtin'), url: 'islemind://builtin' }),
    discover,
    invalidateSession: invalidate,
    reconcileSessions: jest.fn(),
    normalizeServerUrl: value => value.url,
    isAllowedServerUrl: value => value.id === 'builtin' || value.url.startsWith('https://'),
    explicitHttpOnlyErrorText: () => 'HTTP transport required',
    logOperation: async () => {},
    now: () => 100,
  })
  return { catalog, write, discover, invalidate, saved: () => saved }
}

it('does not delete stored configuration when an explicit refresh rejects its endpoint', async () => {
  const legacy = { ...server(), url: 'wss://example.invalid/legacy', transport: 'websocket' as const }
  const f = fixture([legacy, server('unrelated')])
  const result = await f.catalog.refreshManifest(legacy)
  expect(result).toMatchObject({ id: legacy.id, status: 'error', lastError: 'HTTP transport required' })
  expect(f.saved()).toEqual([legacy, server('unrelated')])
  expect(f.write).not.toHaveBeenCalled()
  expect(f.discover).not.toHaveBeenCalled()
})

it('serializes read-modify-write mutations so concurrent additions preserve unrelated servers', async () => {
  const f = fixture()
  const entered = deferred<void>()
  const release = deferred<void>()
  const persist = f.write.getMockImplementation()!
  f.write.mockImplementationOnce(async next => {
    entered.resolve()
    await release.promise
    await persist(next)
  })
  const first = f.catalog.upsertServer(server('first'))
  await entered.promise
  const second = f.catalog.upsertServer(server('second'))
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
  release.resolve()
  await Promise.all([first, second])
  expect(f.saved().map(item => item.id).sort()).toEqual(['first', 'remote', 'second'])
})

it.each(['endpoint', 'approval', 'deleted'] as const)(
  'cannot apply a delayed manifest over a concurrent %s change',
  async change => {
    const f = fixture()
    const original = (await f.catalog.listServers()).find(item => item.id === 'remote')!
    const discovery = deferred<McpCatalogDiscovery>()
    const entered = deferred<void>()
    f.discover.mockImplementationOnce(() => { entered.resolve(); return discovery.promise })
    const refreshing = f.catalog.refreshManifest(original)
    const outcome = refreshing.then(value => value, error => error)
    await entered.promise
    if (change === 'deleted') await f.catalog.removeServer(original.id)
    else await f.catalog.upsertServer({
      ...original, updatedAt: 11,
      ...(change === 'endpoint' ? { url: 'https://example.invalid/changed' } : { approvedToolNames: ['selected-only'] }),
    })
    const concurrent = f.saved()
    discovery.resolve({ tools: [{ name: 'read', inputSchema: { type: 'object' } }], resources: [], prompts: [] })
    expect(await outcome).toEqual(expect.objectContaining({ message: 'mcp_catalog_conflict' }))
    expect(f.saved()).toEqual(concurrent)
    expect(f.invalidate).not.toHaveBeenCalled()
  },
)

it('does not resurrect a removed server by starting a refresh from a stale details screen', async () => {
  const f = fixture([])
  await expect(f.catalog.refreshManifest(server())).rejects.toThrow('mcp_catalog_conflict')
  expect(f.discover).not.toHaveBeenCalled()
  expect(f.write).not.toHaveBeenCalled()
})

it('binds edits, approvals and deletion to the displayed configuration, while preserving unrelated records', async () => {
  const f = fixture([server(), server('unrelated')])
  const original = (await f.catalog.listServers()).find(item => item.id === 'remote')!
  await f.catalog.upsertServer({ ...original, name: 'concurrent name' }, { expectedServer: original })
  const writes = f.write.mock.calls.length
  await expect(f.catalog.upsertServer({ ...original, enabled: false }, { expectedServer: original }))
    .rejects.toThrow('mcp_catalog_conflict')
  await expect(f.catalog.removeServer(original.id, { expectedServer: original }))
    .rejects.toThrow('mcp_catalog_conflict')
  await expect(f.catalog.upsertServer(server(), { expectedServer: null }))
    .rejects.toThrow('mcp_catalog_conflict')
  expect(f.write).toHaveBeenCalledTimes(writes)
  expect(f.saved().find(item => item.id === 'remote')?.name).toBe('concurrent name')
  expect(f.saved().find(item => item.id === 'unrelated')).toMatchObject(server('unrelated'))
})

it('does not turn a catalog persistence failure into a connection failure or overwrite the cached manifest', async () => {
  const f = fixture()
  f.write.mockRejectedValueOnce(new Error('storage unavailable'))
  await expect(f.catalog.refreshManifest(server())).rejects.toThrow('storage unavailable')
  expect(f.saved()).toEqual([server()])
  expect(f.write).toHaveBeenCalledTimes(1)
  expect(f.invalidate).not.toHaveBeenCalled()
  await f.catalog.upsertServer(server('later'))
  expect(f.saved().map(item => item.id)).toEqual(['later', 'remote'])
})

it('drops an aborted queued mutation without poisoning later local saves', async () => {
  const f = fixture()
  const entered = deferred<void>()
  const release = deferred<void>()
  const persist = f.write.getMockImplementation()!
  f.write.mockImplementationOnce(async next => { entered.resolve(); await release.promise; await persist(next) })
  const first = f.catalog.upsertServer(server('first'))
  await entered.promise
  const abort = new AbortController()
  const reason = new Error('cancel queued mutation')
  const queued = f.catalog.upsertServer(server('cancelled'), { signal: abort.signal })
  const outcome = queued.catch(error => error)
  abort.abort(reason)
  release.resolve()
  await first
  expect(await outcome).toBe(reason)
  await f.catalog.upsertServer(server('later'))
  expect(f.saved().map(item => item.id).sort()).toEqual(['first', 'later', 'remote'])
})

it('detaches queued save values, including nested schemas, from later caller mutation', async () => {
  const f = fixture()
  const entered = deferred<void>()
  const release = deferred<void>()
  const persist = f.write.getMockImplementation()!
  f.write.mockImplementationOnce(async next => { entered.resolve(); await release.promise; await persist(next) })
  const first = f.catalog.upsertServer(server('first'))
  await entered.promise
  const input = { ...server('queued'), tools: [{ name: 'read', serverId: 'queued', permission: 'read-only' as const, enabled: false, inputSchema: { properties: { scope: { const: 'shown' } } } }] }
  const queued = f.catalog.upsertServer(input, { expectedServer: null })
  input.name = 'mutated after enqueue'
  input.tools[0].enabled = true
  input.tools[0].inputSchema.properties.scope.const = 'changed'
  release.resolve()
  await Promise.all([first, queued])
  expect(f.saved().find(item => item.id === 'queued')).toMatchObject({
    name: 'queued', tools: [{ enabled: false, inputSchema: { properties: { scope: { const: 'shown' } } } }],
  })
})

it('does not let caller mutation of a queued removal expectation authorize a different saved configuration', async () => {
  const f = fixture()
  const original = (await f.catalog.listServers()).find(item => item.id === 'remote')!
  const entered = deferred<void>()
  const release = deferred<void>()
  const persist = f.write.getMockImplementation()!
  f.write.mockImplementationOnce(async next => { entered.resolve(); await release.promise; await persist(next) })
  const first = f.catalog.upsertServer({ ...original, name: 'concurrent saved configuration' })
  await entered.promise
  const options = { expectedServer: original }
  const removal = f.catalog.removeServer('remote', options)
  const outcome = removal.catch(error => error)
  options.expectedServer.name = 'concurrent saved configuration'
  release.resolve()
  await first
  expect(await outcome).toEqual(expect.objectContaining({ message: 'mcp_catalog_conflict' }))
  expect(f.saved().find(item => item.id === 'remote')?.name).toBe('concurrent saved configuration')
  expect(f.write).toHaveBeenCalledTimes(1)
})

it('detaches a queued whole-catalog save before a caller replaces its array', async () => {
  const f = fixture()
  const entered = deferred<void>()
  const release = deferred<void>()
  const persist = f.write.getMockImplementation()!
  f.write.mockImplementationOnce(async next => { entered.resolve(); await release.promise; await persist(next) })
  const first = f.catalog.upsertServer(server('first'))
  await entered.promise
  const input = [server('shown')]
  const saving = f.catalog.saveServers(input)
  input.push(server('unreviewed'))
  input[0].name = 'changed after enqueue'
  release.resolve()
  await Promise.all([first, saving])
  expect(f.saved()).toHaveLength(1)
  expect(f.saved()).toMatchObject([server('shown')])
})

it('captures manifest request and approval state before asynchronous discovery', async () => {
  const f = fixture()
  const input = (await f.catalog.listServers()).find(item => item.id === 'remote')!
  const entered = deferred<void>()
  const result = deferred<McpCatalogDiscovery>()
  f.discover.mockImplementationOnce(() => { entered.resolve(); return result.promise })
  const refreshing = f.catalog.refreshManifest(input)
  await entered.promise
  input.name = 'changed by caller'
  input.approvedToolNames.push('unreviewed')
  result.resolve({ tools: [], resources: [], prompts: [] })
  const refreshed = await refreshing
  expect(refreshed).toMatchObject({ name: 'remote', approvedToolNames: [] })
  expect(f.saved()[0]).toMatchObject({ name: 'remote', approvedToolNames: [] })
})
