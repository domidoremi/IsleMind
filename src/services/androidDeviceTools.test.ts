import { Platform } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import type { AndroidFileOperationReceipt } from '@/platform/native/androidFileOperations'
import { freezeTaskEffectIntent, freezeTaskEffectReceipt, type TaskEffectRecorder } from '@/modules/tasks'
import { validateToolInputSchema } from '@/modules/integrations'

const mockExecute = jest.fn()
const mockAvailable = jest.fn(() => true)
let mockRequest = 0
jest.mock('@/platform/native/androidFileOperations', () => ({
  createAndroidFileOperationsPort: () => ({ execute: async (action: string, input: unknown, signal?: AbortSignal, before?: (id: string) => Promise<void>) => {
    const requestId = `native-${++mockRequest}`
    await before?.(requestId)
    return { ...await mockExecute(action, input, signal), requestId }
  }, isAvailable: () => mockAvailable() }),
}))
jest.mock('@/platform/native/runtimeLog', () => ({ appendRuntimeLog: jest.fn(async () => undefined) }))
jest.mock('expo-file-system/legacy', () => ({ StorageAccessFramework: { requestDirectoryPermissionsAsync: jest.fn() } }))
jest.mock('@/i18n/service', () => ({ st: (_key: string, _args: unknown, fallback: string) => fallback }))

import { executeAndroidDeviceTool as executeTool, listAndroidDeviceToolManifests } from './androidDeviceTools'

let effects: TaskEffectRecorder
const executeAndroidDeviceTool: typeof executeTool = (tool, args, options) => executeTool(tool, args, { effects, ...options })

const root = 'content://files/tree/root'
const copy = { id: 'copy-1', action: 'copy', sourceUri: `${root}/document/source`,
  targetParentUri: root, targetName: 'copy.txt', requiresUserConfirmation: true, createdAt: 1 }
const success = (action: string, targetUri = `${root}/document/destination`): AndroidFileOperationReceipt => ({
  requestId: 'native-1', action: action as 'copy', status: 'succeeded', effect: 'applied', bytesCopied: 10, targetUri,
  data: action === 'mkdir' ? { ok: true, status: 'created', uri: targetUri }
    : { ok: true, status: 'done', action, targetUri },
})
const tool = (name = 'apply_operations') => listAndroidDeviceToolManifests().find(value => value.name === `android.files.${name}`)!

beforeEach(() => {
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true })
  mockExecute.mockReset()
  mockRequest = 0
  mockAvailable.mockReturnValue(true)
  let pending: string | undefined
  effects = {
    begin: jest.fn(async input => { const intent = freezeTaskEffectIntent(input); expect(pending).toBeUndefined(); pending = intent.id }),
    settle: jest.fn(async input => { const receipt = freezeTaskEffectReceipt(input); expect(receipt.id).toBe(pending); pending = undefined }),
  }
})

test('file capabilities are not advertised without bounded native support', () => {
  mockAvailable.mockReturnValue(false)
  expect(tool().enabled).toBe(false)
  expect(tool('scan').enabled).toBe(false)
  expect(tool('request_directory_access').enabled).toBe(true)
})

test.each(['apply_operations', 'undo_operations'])('%s advertises full manifest objects, not opaque IDs', (name) => {
  const key = name === 'apply_operations' ? 'operations' : 'undoOperations'
  const schema = tool(name).inputSchema
  expect(validateToolInputSchema(schema, { [key]: [copy] }).ok).toBe(true)
  expect(validateToolInputSchema(schema, { [key]: [copy.id] }).ok).toBe(false)
  expect(validateToolInputSchema(schema, { [key]: [{ id: copy.id }] }).ok).toBe(false)
  expect(validateToolInputSchema(schema, { [key]: [{ ...copy, action: 'delete' }] }).ok).toBe(false)
})

test('scan forwards cooperative cancellation', async () => {
  mockExecute.mockResolvedValue({ ...success('scan'), effect: 'none', bytesCopied: 0, data: { directoryUri: root, entries: [], truncated: false } })
  const controller = new AbortController()
  await executeAndroidDeviceTool(tool('scan'), { directoryUri: root }, { signal: controller.signal })
  expect(mockExecute).toHaveBeenCalledWith('scan', expect.objectContaining({ directoryUri: root }), controller.signal)
})

test('only directory access enters the host-owned system picker scope', async () => {
  const request = jest.spyOn(FileSystem.StorageAccessFramework, 'requestDirectoryPermissionsAsync')
    .mockResolvedValue({ granted: true, directoryUri: root })
  const order: string[] = []
  const withSystemPicker = async <T,>(open: () => Promise<T>) => {
    order.push('enter'); const value = await open(); order.push('return'); return value
  }
  try {
    const result = await executeAndroidDeviceTool(tool('request_directory_access'), { initialUri: root }, { withSystemPicker })
    expect(result.observation.ok).toBe(true)
    expect(request).toHaveBeenCalledWith(root)
    expect(order).toEqual(['enter', 'return'])
    mockExecute.mockResolvedValue({ ...success('scan'), effect: 'none', bytesCopied: 0,
      data: { directoryUri: root, entries: [], truncated: false } })
    await executeAndroidDeviceTool(tool('scan'), { directoryUri: root, withSystemPicker: true }, { withSystemPicker })
    expect(order).toEqual(['enter', 'return'])
  } finally { request.mockRestore() }
})

test('first-call partial failure retains the destination and prohibits blind replay', async () => {
  mockExecute.mockResolvedValue({ ...success('copy'), status: 'failed', effect: 'partial', reason: 'byte_limit', data: undefined })
  const result = await executeAndroidDeviceTool(tool(), { operations: [copy] })
  expect(result.observation.ok).toBe(false)
  expect(result.observation.status).toBe('error')
  expect(result.observation.metadata).toMatchObject({ replaySafe: false, partialFailure: true,
    fileOperationReceipts: [expect.objectContaining({ operationId: 'copy-1', effect: 'partial', targetUri: expect.stringContaining('destination') })] })
  expect(mockExecute).toHaveBeenCalledTimes(1)
})

test('cancelled second call preserves the first result and stops the third call', async () => {
  mockExecute.mockResolvedValueOnce(success('copy'))
    .mockResolvedValueOnce({ ...success('copy'), status: 'cancelled', effect: 'partial', reason: 'cancelled' })
  const result = await executeAndroidDeviceTool(tool(), { operations: [copy, { ...copy, id: 'copy-2' }, { ...copy, id: 'copy-3' }] })
  expect(result.observation.ok).toBe(false)
  expect(result.observation.errorCode).toBe('cancelled')
  expect(result.observation.metadata).toMatchObject({ applied: 1, replaySafe: false,
    results: [expect.objectContaining({ operationId: 'copy-1', status: 'done' })],
    fileOperationReceipts: [expect.objectContaining({ effect: 'applied' }), expect.objectContaining({ effect: 'partial', status: 'cancelled' })] })
  expect(mockExecute).toHaveBeenCalledTimes(2)
})

test('implicitly created destination survives a subsequent failed copy in the receipts', async () => {
  mockExecute.mockResolvedValueOnce(success('mkdir', `${root}/document/newdir`))
    .mockResolvedValueOnce({ ...success('copy'), status: 'failed', effect: 'none', bytesCopied: 0, reason: 'permission_required' })
  const result = await executeAndroidDeviceTool(tool(), { operations: [{ ...copy, targetDirectoryName: 'newdir' }] })
  expect(result.observation.ok).toBe(false)
  expect(result.observation.metadata).toMatchObject({ partialFailure: true, replaySafe: false,
    fileOperationReceipts: [expect.objectContaining({ action: 'mkdir', effect: 'applied' }), expect.objectContaining({ action: 'copy', effect: 'none' })] })
})

test('conflict skips do not become completed operations', async () => {
  mockExecute.mockResolvedValue({ ...success('copy'), effect: 'none', bytesCopied: 0, data: { ok: false, status: 'skipped', reason: 'target_exists' } })
  const result = await executeAndroidDeviceTool(tool(), { operations: [copy, { ...copy, id: 'not-dispatched' }] })
  expect(result.observation.ok).toBe(false)
  expect(result.observation.status).toBe('skipped')
  expect(result.observation.errorCode).toBe('policy_denied')
  expect(result.observation.metadata).toMatchObject({ applied: 0, skipped: 1 })
  expect(effects.settle).toHaveBeenCalledWith(expect.objectContaining({ status: 'skipped', effect: 'none' }))
  expect(mockExecute).toHaveBeenCalledTimes(1)
})

test('an existing directory satisfies mkdir without claiming a new effect', async () => {
  mockExecute.mockResolvedValue({ ...success('mkdir'), effect: 'none', bytesCopied: 0, data: { ok: true, status: 'existing', uri: root } })
  const result = await executeAndroidDeviceTool(tool(), { operations: [{ id: 'mkdir-1', action: 'mkdir', targetParentUri: root, targetName: 'existing' }] })
  expect(result.observation.ok).toBe(true)
  expect(result.observation.metadata).toMatchObject({ applied: 0, skipped: 1,
    fileOperationReceipts: [expect.objectContaining({ effect: 'none' })] })
})

test('file writes without a Tasks-owned recorder fail closed', async () => {
  const result = await executeTool(tool(), { operations: [copy] })
  expect(result.observation).toMatchObject({ ok: false, errorCode: 'evidence_insufficient' })
  expect(mockExecute).not.toHaveBeenCalled()
})

test.each(['begin', 'settle'] as const)('failed %s durability barrier stops subsequent I/O', async phase => {
  mockExecute.mockImplementation(async action => success(action))
  effects[phase] = jest.fn(async () => { throw new Error('disk full') })
  const result = await executeAndroidDeviceTool(tool(), { operations: [{ ...copy, targetDirectoryName: 'newdir' }] })
  expect(result.observation.ok).toBe(false)
  expect(mockExecute).toHaveBeenCalledTimes(phase === 'begin' ? 0 : 1)
})

test('implicit mkdir and copy each await their own two durability barriers', async () => {
  const order: string[] = []
  effects = { async begin(input) { order.push(`begin:${input.action}`) }, async settle(input) { order.push(`settle:${input.id}`) } }
  mockExecute.mockImplementation(async action => { order.push(`execute:${action}`); return success(action) })
  const result = await executeAndroidDeviceTool(tool(), { operations: [{ ...copy, targetDirectoryName: 'newdir' }] })
  expect(result.observation.ok).toBe(true)
  expect(order).toEqual(['begin:mkdir', 'execute:mkdir', 'settle:native-1', 'begin:copy', 'execute:copy', 'settle:native-2'])
})

test('maximum batch retains all 64 compact native receipts through integration normalization', async () => {
  let sequence = 0
  mockExecute.mockImplementation(async (action: string) => success(action, `${root}/document/item-${++sequence}`))
  const operations = Array.from({ length: 32 }, (_, index) => ({ ...copy, id: `copy-${index}`, targetDirectoryName: `dir-${index}` }))
  const result = await executeAndroidDeviceTool(tool(), { operations })
  expect(result.observation.ok).toBe(true)
  const receipts = result.observation.metadata?.fileOperationReceipts as unknown as AndroidFileOperationReceipt[]
  expect(receipts).toHaveLength(64)
  expect(receipts[63]).toMatchObject({ effect: 'applied', targetUri: `${root}/document/item-64` })
  expect(receipts.every(receipt => receipt.data === undefined)).toBe(true)
})

test('receipt budget stops subsequent writes without discarding the last effect', async () => {
  const target = `${root}/document/${'a'.repeat(3500)}`
  mockExecute.mockResolvedValue(success('rename', target))
  const operations = Array.from({ length: 12 }, (_, index) => ({ ...copy, id: `rename-${index}`, action: 'rename' }))
  const result = await executeAndroidDeviceTool(tool(), { operations })
  expect(result.observation.ok).toBe(false)
  expect(result.observation.errorCode).toBe('step_limit_reached')
  const receipts = result.observation.metadata?.fileOperationReceipts as unknown as AndroidFileOperationReceipt[]
  expect(receipts).toHaveLength(mockExecute.mock.calls.length)
  expect(receipts.length).toBeLessThan(12)
  expect(receipts.at(-1)).toMatchObject({ effect: 'applied', targetUri: target })
  expect(result.observation.metadata?.replaySafe).toBe(false)
})

test.each([
  [copy, { ...copy, id: 'missing-source', sourceUri: undefined, targetDirectoryName: 'must-not-create' }],
  [copy, copy],
  Array.from({ length: 33 }, (_, index) => ({ ...copy, id: `copy-${index}` })),
])('invalid batches are rejected before the first side effect', async (...operations) => {
  const result = await executeAndroidDeviceTool(tool(), { operations })
  expect(result.observation.ok).toBe(false)
  expect(mockExecute).not.toHaveBeenCalled()
})
