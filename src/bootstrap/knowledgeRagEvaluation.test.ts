import { clearRagQueryCaches, runRagGoldEvaluation } from './knowledgeRagEvaluation'
import type { Settings } from '@/types/settingsContracts'

const mockEvaluate = jest.fn()
const mockLog = jest.fn()
const mockClear = jest.fn()
jest.mock('@/modules/knowledge', () => ({
  evaluateRagGoldSet: (...args: unknown[]) => mockEvaluate(...args),
  summarizeRagEvaluationRun: () => ({ confidence: 1 }),
}))
jest.mock('./ragEvaluationRepository', () => ({ ragEvaluationRepository: { log: (...args: unknown[]) => mockLog(...args) } }))
jest.mock('./knowledgeRepository', () => ({
  clearKnowledgeIndexCaches: (...args: unknown[]) => mockClear(...args),
}))
const settings = { language: 'en', ragProfile: 'balanced' } as Settings
const run = { id: 'gold', cases: [{ sourceCount: 2 }], fallbackReasons: [] }
beforeEach(() => {
  mockEvaluate.mockReset().mockResolvedValue(run)
  mockLog.mockReset().mockResolvedValue(undefined)
  mockClear.mockReset().mockResolvedValue(undefined)
})

it('rejects pre-admission cancellation without evaluating or logging', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(runRagGoldEvaluation(settings, {}, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(mockEvaluate).not.toHaveBeenCalled()
  expect(mockLog).not.toHaveBeenCalled()
})

it('captures input settings, conversation and signal before evaluation settlement', async () => {
  const input = { ...settings }, conversation = { title: 'Reviewed', systemPrompt: 'Original' }
  const controller = new AbortController(), options = { signal: controller.signal }
  let finish!: () => void
  mockEvaluate.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(run) }))
  const promise = runRagGoldEvaluation(input, conversation, options)
  input.ragProfile = 'fast'; conversation.title = 'Changed'; options.signal = new AbortController().signal
  expect(mockEvaluate.mock.calls[0][0].ragProfile).toBe('balanced')
  expect(mockEvaluate.mock.calls[0][1].title).toBe('Reviewed')
  expect(mockEvaluate.mock.calls[0][2].signal).toBe(controller.signal)
  finish()
  await promise
})

it('waits for admitted evaluation then prevents logging after cancellation', async () => {
  let finish!: () => void
  mockEvaluate.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(run) }))
  const controller = new AbortController()
  const promise = runRagGoldEvaluation(settings, {}, { signal: controller.signal })
  controller.abort()
  const check = expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  expect(mockLog).not.toHaveBeenCalled()
  finish()
  await check
  expect(mockLog).not.toHaveBeenCalled()
})

it('waits for an admitted log and does not return success after cancellation', async () => {
  let finish!: () => void
  mockLog.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const controller = new AbortController()
  const promise = runRagGoldEvaluation(settings, {}, { signal: controller.signal })
  await Promise.resolve()
  expect(mockLog).toHaveBeenCalledTimes(1)
  controller.abort()
  const check = expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  finish()
  await check
})

it('propagates log failure rather than claiming a saved evaluation', async () => {
  mockLog.mockRejectedValueOnce(new Error('Log write failed'))
  await expect(runRagGoldEvaluation(settings)).rejects.toThrow('Log write failed')
})

it('forwards cache cancellation and rejects before admitting a cache write', async () => {
  const controller = new AbortController()
  await clearRagQueryCaches({ signal: controller.signal })
  expect(mockClear).toHaveBeenCalledWith({ signal: controller.signal })
  mockClear.mockClear(); controller.abort()
  await expect(clearRagQueryCaches({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(mockClear).not.toHaveBeenCalled()
})

it('waits for admitted cache write settlement and retains its captured cancellation signal', async () => {
  let finish!: () => void
  mockClear.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const controller = new AbortController(), options = { signal: controller.signal }
  const promise = clearRagQueryCaches(options)
  options.signal = new AbortController().signal
  controller.abort()
  expect(mockClear.mock.calls[0][0].signal).toBe(controller.signal)
  const check = expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  finish()
  await check
})
