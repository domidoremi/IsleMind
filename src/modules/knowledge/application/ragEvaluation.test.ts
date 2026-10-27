import { evaluateRagGoldSet, RAG_GOLD_CASES } from './ragEvaluation'
import type { Settings } from '@/types/settingsContracts'

const mockRag = jest.fn()
jest.mock('./ragOrchestration', () => ({
  runAgenticRag: (...args: unknown[]) => mockRag(...args),
  verifyRagGeneration: () => ({ confidence: 1, unsupportedClaimCount: 0, factualClaimCount: 1 }),
}))
const pack = { citations: [], sources: [], contextPrompt: '', quality: { citationCoverage: 1, contextPrecision: 1, fallbackReasons: [] } }
beforeEach(() => { mockRag.mockReset().mockResolvedValue(pack) })
const settings = { language: 'en', ragProfile: 'balanced' } as Settings

it('does not admit a gold case when the caller is already cancelled', async () => {
  const controller = new AbortController(); controller.abort()
  await expect(evaluateRagGoldSet(settings, {}, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(mockRag).not.toHaveBeenCalled()
})

it('waits for the admitted case then prevents later case admission on cancellation', async () => {
  let finish!: () => void
  mockRag.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(pack) }))
  const controller = new AbortController()
  const promise = evaluateRagGoldSet(settings, {}, { signal: controller.signal })
  expect(mockRag).toHaveBeenCalledTimes(1)
  expect(mockRag.mock.calls[0][0].signal).toBe(controller.signal)
  controller.abort()
  const check = expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  finish()
  await check
  expect(mockRag).toHaveBeenCalledTimes(1)
})

it('uses captured settings and conversation across case settlement', async () => {
  let finish!: () => void
  mockRag.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(pack) }))
  const input = { ...settings }, conversation = { title: 'Reviewed', systemPrompt: 'Original' }
  const promise = evaluateRagGoldSet(input, conversation)
  input.ragProfile = 'fast'; conversation.title = 'Changed'
  finish()
  await promise
  expect(mockRag).toHaveBeenCalledTimes(RAG_GOLD_CASES.length)
  for (const [options] of mockRag.mock.calls) {
    expect(options.settings.ragProfile).toBe('balanced')
    expect(options.conversationTitle).toBe('Reviewed')
  }
})
