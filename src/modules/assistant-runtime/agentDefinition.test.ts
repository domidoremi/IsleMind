import { createAgentDefinition, decodeAgentDefinition, encodeAgentDefinition, freezeAgentDefinition, getAgentDefinitionToolIds, MAX_AGENT_DEFINITION_BYTES, parseAgentDefinition } from './agentDefinition'

const definition = () => createAgentDefinition({ id: 'agent-1', name: 'Research', providerId: 'provider-1', modelId: 'model/one' })

test('versioned definitions use safe defaults and round trip as data only', () => {
  const original = definition()
  expect(decodeAgentDefinition(encodeAgentDefinition(original))).toEqual(original)
  expect(original.budget).toEqual({ modelRequests: 24, tools: 48, tokens: 120_000, activeMs: 1_800_000 })
  expect(original.children).toEqual({ maxConcurrent: 2, maxTotal: 6, maxDepth: 1 })
  expect(original.modelBinding.actionCapability).toBe('text_only')
})

test.each(['apiKey', 'credentials', 'baseUrl', 'grants', 'script', '__proto__'])('rejects untrusted top-level %s instead of importing executable authority', (key) => {
  const source = JSON.parse(encodeAgentDefinition(definition()))
  Object.defineProperty(source, key, { value: 'untrusted', enumerable: true })
  expect(() => parseAgentDefinition(source)).toThrow()
})

test('rejects unknown versions, nested connection fields, json_mode tools, invalid ids and oversized imports', () => {
  expect(() => parseAgentDefinition({ ...definition(), version: 2 })).toThrow()
  for (const extra of [{ apiKey: 'untrusted' }, { baseUrl: 'https://example.com' }, { actionCapability: 'json_mode' }]) {
    expect(() => parseAgentDefinition({ ...definition(), modelBinding: { ...definition().modelBinding, ...extra } })).toThrow()
  }
  expect(() => parseAgentDefinition({ ...definition(), allowedToolIds: ['https://example.com/tool'] })).toThrow()
  expect(() => decodeAgentDefinition(' '.repeat(MAX_AGENT_DEFINITION_BYTES + 1))).toThrow()
  expect(() => parseAgentDefinition({ ...definition(), instructions: '界'.repeat(24_000) })).toThrow()
})

test('frozen run binding is a deeply immutable independent snapshot and text-only never enables tools', () => {
  const mutable = { ...definition(), allowedToolIds: ['web-search'] }
  const frozen = freezeAgentDefinition(mutable)
  mutable.allowedToolIds.push('write-file')
  mutable.modelBinding.modelId = 'changed'
  expect(frozen.allowedToolIds).toEqual(['web-search'])
  expect(frozen.modelBinding.modelId).toBe('model/one')
  expect(Object.isFrozen(frozen.budget)).toBe(true)
  expect(Object.isFrozen(frozen.allowedToolIds)).toBe(true)
  expect(getAgentDefinitionToolIds(frozen)).toEqual([])
  const toolDefinition = { ...definition(), allowedToolIds: ['web-search'], modelBinding: { ...definition().modelBinding, actionCapability: 'validated_structured_actions' as const } }
  expect(getAgentDefinitionToolIds(freezeAgentDefinition(toolDefinition))).toEqual(['web-search'])
})

test('enforces reviewer, child, list and budget hard bounds', () => {
  for (const patch of [
    { reviewerPolicy: { mode: 'read_only', maxReviews: 3, agentId: 'reviewer' } },
    { reviewerPolicy: { mode: 'read_only', maxReviews: 1 } },
    { reviewerPolicy: { mode: 'write', maxReviews: 1, agentId: 'reviewer' } },
    { delegateAgentIds: ['agent-1'] }, { skillIds: ['duplicate', 'duplicate'] },
    { children: { maxConcurrent: 3, maxTotal: 6, maxDepth: 1 } },
    { children: { maxConcurrent: 2, maxTotal: 7, maxDepth: 1 } },
    { children: { maxConcurrent: 2, maxTotal: 6, maxDepth: 2 } },
    { children: { maxConcurrent: 2, maxTotal: 6, maxDepth: 0 } },
    { budget: { ...definition().budget, modelRequests: 257 } },
    { budget: { ...definition().budget, tokens: -1 } },
  ]) expect(() => parseAgentDefinition({ ...definition(), ...patch })).toThrow()
})
