import { MAX_PROVIDER_RESPONSE_CHARACTERS, safeProviderResponseText } from './providerTransportUtils'

test('rejects a buffered huge JSON before parsing instead of treating it as empty content', async () => {
  await expect(safeProviderResponseText({ text: async () => 'x'.repeat(MAX_PROVIDER_RESPONSE_CHARACTERS + 1) })).rejects.toThrow('parsing limit')
})
test('refuses an oversized declared body without reading it', async () => {
  const text = jest.fn(async () => 'unused')
  await expect(safeProviderResponseText({ text, headers: { get: () => String(MAX_PROVIDER_RESPONSE_CHARACTERS * 4 + 1) } as unknown as Headers })).rejects.toThrow('parsing limit')
  expect(text).not.toHaveBeenCalled()
})
test('bounded streamed text releases its cursor on success and overflow', async () => {
  for (const overflow of [false, true]) {
    const reader = { read: jest.fn().mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(overflow ? 'x'.repeat(MAX_PROVIDER_RESPONSE_CHARACTERS + 1) : 'hello') }).mockResolvedValue({ done: true }),
      cancel: jest.fn(async () => {}), releaseLock: jest.fn() }
    const response = { text: jest.fn(), body: { getReader: () => reader } } as unknown as Response
    if (overflow) { await expect(safeProviderResponseText(response)).rejects.toThrow('parsing limit'); expect(reader.cancel).toHaveBeenCalledTimes(1) }
    else expect(await safeProviderResponseText(response)).toBe('hello')
    expect(reader.releaseLock).toHaveBeenCalledTimes(1)
    expect(response.text).not.toHaveBeenCalled()
  }
})
