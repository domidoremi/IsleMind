import { asTaskId, type JsonRecord } from '@/core'
import { createBuiltInCapabilityAdapter, listRunnableBuiltInCapabilityToolNames } from './builtInCapabilityAdapter'
import type { BuiltInCapabilityAdapterDependencies, BuiltInWorkspaceFilePage } from './builtInCapabilityContracts'

const file = (relativePath: string) => ({ relativePath, revision: `sha256:${'a'.repeat(64)}`, byteLength: 10, mimeType: 'text/plain' })
function fixture() {
  const queryFiles = jest.fn(async () => ({ files: [file('workspace/a.txt')] } as BuiltInWorkspaceFilePage))
  const dependencies: BuiltInCapabilityAdapterDependencies = {
    admission: { async admit(request) { return { status: 'allowed', taskId: request.taskId, toolId: request.toolId, grantedPermissions: ['files.read'], confirmed: true } } },
    workspaceFileQuery: { workspaceScopeId: 'workspace', queryFiles },
  }
  const call = (name: 'list_files' | 'search_files', args: JsonRecord = {}, signal = new AbortController().signal) => {
    const adapter = createBuiltInCapabilityAdapter(name, dependencies)
    return adapter.execute({ taskId: asTaskId('task'), tool: adapter.definition, arguments: args }, { signal })
  }
  return { dependencies, queryFiles, call }
}

test('advertises discovery only with a concrete query port, never from read/write availability', () => {
  const f = fixture()
  expect(listRunnableBuiltInCapabilityToolNames(f.dependencies)).toEqual(['list_files', 'search_files'])
  expect(listRunnableBuiltInCapabilityToolNames({ admission: f.dependencies.admission })).toEqual([])
})

test('permission denial and pre-cancellation do not touch the platform port', async () => {
  const f = fixture()
  f.dependencies.admission = { async admit() { return { status: 'denied' } } }
  expect((await f.call('list_files')).observation.ok).toBe(false)
  const controller = new AbortController(); controller.abort()
  expect((await f.call('list_files', {}, controller.signal)).capabilityOutcome.code).toBe('cancelled')
  expect(f.queryFiles).not.toHaveBeenCalled()
})

test.each<Partial<BuiltInWorkspaceFilePage>>([
  { files: [file('knowledge/private.txt')] },
  { files: [file('workspace/a.txt'), file('workspace/a.txt')] },
  { files: [file('workspace/z.txt'), file('workspace/a.txt')] },
  { files: [file('workspace/a.txt')], nextAfterPath: 'workspace/missing.txt' },
  { files: [], nextAfterPath: 'workspace/a.txt' },
  { files: [{ ...file('workspace/a.txt'), byteLength: -1 }] },
  { files: [{ ...file('workspace/a.txt'), mimeType: 'x'.repeat(10_000) }] },
])('rejects malformed, out-of-scope or non-advancing platform pages %#', async page => {
  const f = fixture()
  f.queryFiles.mockResolvedValue(page as BuiltInWorkspaceFilePage)
  expect((await f.call('list_files')).observation.ok).toBe(false)
})

test('checks cursor order using SQLite binary Unicode order and strips adapter-private fields', async () => {
  const f = fixture()
  f.queryFiles.mockResolvedValue({ files: [{ ...file('workspace/😀.txt'), privatePath: 'not-for-the-model' } as ReturnType<typeof file>] })
  const result = await f.call('list_files', { afterPath: 'workspace/\uE000.txt' })
  expect(result.observation.ok).toBe(true)
  expect(result.observation.blocks[0].text).not.toContain('not-for-the-model')
  expect((await f.call('list_files', { afterPath: 'workspace/😀.txt' })).observation.ok).toBe(false)
})

test('requires bounded literal search and a bounded excerpt from the platform', async () => {
  const f = fixture()
  expect((await f.call('search_files')).observation.ok).toBe(false)
  expect(f.queryFiles).not.toHaveBeenCalled()
  expect((await f.call('search_files', { query: 'text' })).observation.ok).toBe(false)
  f.queryFiles.mockResolvedValue({ files: [{ ...file('workspace/a.txt'), snippet: 'matched text' }] })
  expect((await f.call('search_files', { query: 'text' })).observation.ok).toBe(true)
  f.queryFiles.mockResolvedValue({ files: [{ ...file('workspace/a.txt'), snippet: 'x'.repeat(641) }] })
  expect((await f.call('search_files', { query: 'text' })).observation.ok).toBe(false)
})
