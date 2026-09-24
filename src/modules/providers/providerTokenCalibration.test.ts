import { createProviderTokenCalibration } from './providerTokenCalibration'
import { checkProviderContextCapacity } from './providerContextCapacity'

test('calibrates per provider/model/protocol without duplicate cumulative usage or downward drift', () => {
  const calibration = createProviderTokenCalibration()
  calibration.observe({ key: 'a/chat', attemptId: '1', rawInputTokens: 100, actualInputTokens: 150 })
  calibration.observe({ key: 'a/chat', attemptId: '1', rawInputTokens: 100, actualInputTokens: 200 })
  expect(calibration.factor('a/chat')).toBe(1.5)
  calibration.observe({ key: 'a/chat', attemptId: '2', rawInputTokens: 100, actualInputTokens: 50 })
  expect(calibration.factor('a/chat')).toBe(1.5)
  expect(calibration.factor('a/responses')).toBe(1)
})

test('the calibrated final gate counts mixed-language code and cannot exceed 85 percent', () => {
  const body = { messages: [{ content: '中文 code { "x": [1,2,3] } '.repeat(20) }], max_tokens: 10 }
  const raw = checkProviderContextCapacity({ body, contextWindow: 10_000, defaultOutputTokens: 10 })
  expect(() => checkProviderContextCapacity({ body, contextWindow: Math.ceil(raw.estimatedInputTokens * 1.3), defaultOutputTokens: 10, inputCalibrationFactor: 1.5 })).toThrow('context_capacity')
})
