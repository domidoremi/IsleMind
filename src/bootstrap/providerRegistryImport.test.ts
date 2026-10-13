import { parseCredentialGroups, parseProviderImportText } from './providerRegistry'

test.each(['{ invalid local QA fixture', '{"name":"Incomplete"', '[{"name":"Incomplete"},', '{}', '[]', '[1,2]', '{"unrelated":true}'])('does not reinterpret invalid or empty provider JSON as a named text connection: %s', input => {
  const parsed = parseProviderImportText(input)
  expect(parsed.sourceType).toBe('json')
  expect(parsed.providers).toEqual([])
  expect(parsed.warnings).toHaveLength(1)
})

test('continues accepting explicit plain-text and CSV provider connections', () => {
  for (const input of [
    'Name: Local fixture\nBase URL: http://127.0.0.1:18741/v1\nAPI Key: synthetic-local-only\nModels: gpt-4.1-mini',
    'name,base_url,api_key,models\nLocal fixture,http://127.0.0.1:18741/v1,synthetic-local-only,gpt-4.1-mini',
  ]) {
    const parsed = parseProviderImportText(input)
    expect(parsed.providers).toHaveLength(1)
    expect(parsed.providers[0]).toMatchObject({ name: 'Local fixture', baseUrl: 'http://127.0.0.1:18741/v1', models: ['gpt-4.1-mini'] })
  }
})

test('JSON import retains an explicit provider preset and its declared native tool support without probing', () => {
  const parsed = parseProviderImportText(JSON.stringify({ presetId: 'openai', name: 'Synthetic',
    baseUrl: 'https://import-fixture.invalid/v1', apiKey: 'sk-synthetic-import-only', models: ['gpt-4.1-mini'] }))
  expect(parsed.providers).toHaveLength(1)
  expect(parsed.providers[0]).toMatchObject({ presetId: 'openai', type: 'openai', capabilities: { nativeTools: true } })
})

test.each(['local', 'qa-local-fixture', 'eyJhbGci.fixture.signature', 'opaque+/value='])('preserves explicitly named credentials without guessing a vendor format: %s', apiKey => {
  const parsed = parseProviderImportText(JSON.stringify({ name: 'Local fixture', baseUrl: 'http://127.0.0.1:18741/v1', apiKey }))
  expect(parsed.providers[0].credentialGroups?.map(group => group.apiKey)).toEqual([apiKey])
  expect(parseCredentialGroups(JSON.stringify({ apiKey }))[0].apiKey).toBe(apiKey)
  expect(parseCredentialGroups(`API Key: ${apiKey}`)[0].apiKey).toBe(apiKey)
})

test('does not turn short prose, URLs, model labels or credential placeholders into tokens', () => {
  for (const text of ['local', 'Name: local', 'Models: qa-local-fixture', 'Key: https://example.invalid', 'Key: paste your key here']) {
    expect(parseCredentialGroups(text)).toHaveLength(0)
  }
})

test.each(['local', 'synthetic-local-only', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlLW9ubHkifQ.signature', 'opaque+/value='])('preserves an explicitly entered token as one opaque value: %s', apiKey => {
  expect(parseCredentialGroups(apiKey, { explicit: true }).map(group => group.apiKey)).toEqual([apiKey])
  expect(parseCredentialGroups(JSON.stringify([apiKey]), { explicit: true }).map(group => group.apiKey)).toEqual([apiKey])
})

test('explicit token fields keep batch and labeled formats without treating prose or URLs as credentials', () => {
  expect(parseCredentialGroups('local\nAPI Key: opaque+/value=\nProduction:sk-fixture', { explicit: true }).map(group => group.apiKey))
    .toEqual(['local', 'opaque+/value=', 'sk-fixture'])
  for (const text of ['paste your key here', 'https://example.invalid', 'Models:fixture-model']) {
    expect(parseCredentialGroups(text, { explicit: true })).toHaveLength(0)
  }
})

test('JSON import retains an explicit compatible wire protocol but cannot invent a preset', () => {
  const parsed = parseProviderImportText(JSON.stringify({ presetId: 'not-a-provider', protocol: 'anthropic-compatible', name: 'Synthetic',
    baseUrl: 'https://import-fixture.invalid', apiKey: 'sk-synthetic-import-only', models: ['claude-sonnet-4'] }))
  expect(parsed.providers[0]).toMatchObject({ type: 'openai-compatible', wireProtocol: 'anthropic-compatible' })
  expect(parsed.providers[0].presetId).not.toBe('not-a-provider')
})
