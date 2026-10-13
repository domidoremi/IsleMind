import { loadWorkspaceEditReview } from './workspaceEditReview'

const mockFiles = { inspect: jest.fn(), readText: jest.fn(), editTextAtomic: jest.fn() }
jest.mock('./builtInWorkspaceFileRuntime', () => ({ builtInWritableWorkspaceFilePort: {
  inspect: (...args: unknown[]) => mockFiles.inspect(...args),
  readText: (...args: unknown[]) => mockFiles.readText(...args),
  editTextAtomic: (...args: unknown[]) => mockFiles.editTextAtomic(...args),
} }))
const revision = 'sha256:' + '1'.repeat(64)
const pending = (updates: Record<string, string> = {}) => ({
  operationId: 'builtin:islemind-builtins:edit_file',
  continuationState: { call: { operationId: 'builtin:islemind-builtins:edit_file',
    arguments: { path: 'workspace/example.ts', expectedRevision: revision, text: 'const answer = 42\n', ...updates } } },
})
beforeEach(() => {
  jest.clearAllMocks()
  mockFiles.inspect.mockResolvedValue({ relativePath: 'workspace/example.ts', revision, byteLength: 20, mimeType: 'text/plain' })
  mockFiles.readText.mockResolvedValue({ relativePath: 'workspace/example.ts', revision, byteLength: 20, mimeType: 'text/plain', text: 'const answer = 0\n' })
})
afterEach(() => expect(mockFiles.editTextAtomic).not.toHaveBeenCalled())

it('previews the exact proposed file change without applying it', async () => {
  const diff = await loadWorkspaceEditReview(pending(), new AbortController().signal)
  expect(diff).toContain('- const answer = 0')
  expect(diff).toContain('+ const answer = 42')
  expect(mockFiles.readText).toHaveBeenCalledWith('workspace/example.ts', expect.objectContaining({ maxBytes: 16_000 }))
})
it('does not read files for other operations', async () => {
  expect(await loadWorkspaceEditReview({ ...pending(), operationId: 'mcp:remote:edit_file' }, new AbortController().signal)).toBeUndefined()
  expect(mockFiles.inspect).not.toHaveBeenCalled()
})
it('refuses a stale file revision rather than approving a different diff', async () => {
  await expect(loadWorkspaceEditReview(pending({ expectedRevision: 'sha256:' + '2'.repeat(64) }), new AbortController().signal)).rejects.toThrow('workspace_edit_preview_unavailable')
  expect(mockFiles.readText).not.toHaveBeenCalled()
})
it('previews creation only while the target is actually absent', async () => {
  mockFiles.inspect.mockResolvedValue(undefined)
  expect(await loadWorkspaceEditReview(pending({ expectedRevision: 'absent:v1' }), new AbortController().signal)).toContain('--- /dev/null')
  expect(mockFiles.readText).not.toHaveBeenCalled()
})
it('refuses redacted or truncated edits instead of treating a partial preview as approval', async () => {
  await expect(loadWorkspaceEditReview(pending({ text: '{"api_key":"fixture-private-value"}' }), new AbortController().signal)).rejects.toThrow('workspace_edit_preview_unavailable')
  await expect(loadWorkspaceEditReview(pending({ text: 'a'.repeat(16_001) }), new AbortController().signal)).rejects.toThrow('workspace_edit_preview_unavailable')
})
