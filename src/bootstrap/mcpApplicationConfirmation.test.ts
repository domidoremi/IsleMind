import { callMcpTool } from './mcpExecutionRuntime'
import type { McpServerConfig } from '@/types/mcpContracts'

const mockLookup = jest.fn()
const mockExecute = jest.fn(async (..._args: unknown[]) => ({ ok: true, content: [{ type: 'text', text: 'Changed' }],
  trace: { id: 'result', type: 'tool', title: 'set_theme_mode', status: 'done' } }))
jest.mock('./taskRuntime', () => ({ createTaskRuntime: () => ({ getTask: (...args: unknown[]) => mockLookup(...args) }) }))
jest.mock('./mcpCatalog', () => ({ mcpClient: {}, resolveBuiltInCapabilityAdapter: () => undefined }))
jest.mock('./contextArtifactRuntime', () => ({ contextArtifactRuntime: {} }))
jest.mock('@/services/runtimeHealthLog', () => ({ logMcpOperation: async () => undefined }))
jest.mock('@/presentation/features/settings/settingsActionCommand', () => ({ executeSettingsAction: (...args: unknown[]) => mockExecute(...args) }))

const server = { id: 'islemind-builtins', name: 'Built in', enabled: true, status: 'connected',
  tools: [{ name: 'set_theme_mode', permission: 'read-write', enabled: true, serverId: 'islemind-builtins' }],
  approvedToolNames: ['set_theme_mode'], resources: [], prompts: [],
} as unknown as McpServerConfig
const task = { id: 'task', toolId: 'builtin:islemind-builtins:set_theme_mode', status: 'running',
  policy: { outcome: 'requires-confirmation' }, confirmationConfirmedAt: 100, idempotencyKey: 'one-operation' }

beforeEach(() => { jest.clearAllMocks(); mockLookup.mockResolvedValue(task) })

it('executes a durably confirmed running task while retaining its original confirmation policy', async () => {
  const result = await callMcpTool(server, 'set_theme_mode', { mode: 'dark' }, undefined, { taskId: 'task', skipApproval: true })
  expect(result.observation.ok).toBe(true)
  expect(mockExecute).toHaveBeenCalledTimes(1)
})

it.each([
  ['unconfirmed', { confirmationConfirmedAt: undefined }],
  ['invalid confirmation', { confirmationConfirmedAt: Number.NaN }],
  ['not running', { status: 'awaiting-confirmation' }],
  ['denied despite timestamp', { policy: { outcome: 'denied' } }],
  ['different operation', { toolId: 'builtin:islemind-builtins:set_theme_family' }],
  ['missing idempotency', { idempotencyKey: '' }],
])('refuses %s without invoking the application mutation', async (_label, patch) => {
  mockLookup.mockResolvedValue({ ...task, ...patch })
  const result = await callMcpTool(server, 'set_theme_mode', { mode: 'dark' }, undefined, { taskId: 'task', skipApproval: true })
  expect(result.observation.ok).toBe(false)
  expect(mockExecute).not.toHaveBeenCalled()
})
