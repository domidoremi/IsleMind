import { createAgentDefinition, freezeAgentDefinition } from './agentDefinition'
import { decodeDelegation, narrowChildDefinition, parseDelegation } from './agentCollaboration'

const agent = (id: string) => createAgentDefinition({ id, name: id, providerId: 'provider', modelId: 'model' })

test('child definitions intersect root authority and cannot recursively delegate or review', () => {
  const root = agent('root'); root.allowedToolIds = ['shared']; root.knowledgeIds = ['shared-knowledge']
  const child = agent('child'); child.allowedToolIds = ['shared', 'private']; child.knowledgeIds = ['shared-knowledge', 'private-knowledge']
  child.delegateAgentIds = ['third']; child.reviewerPolicy = { mode: 'read_only', agentId: 'reviewer', maxReviews: 2 }
  child.budget.modelRequests = 200
  const narrowed = narrowChildDefinition(freezeAgentDefinition(root), child)
  expect(narrowed.allowedToolIds).toEqual(['shared']); expect(narrowed.knowledgeIds).toEqual(['shared-knowledge'])
  expect(narrowed.delegateAgentIds).toEqual([]); expect(narrowed.children).toEqual({ maxConcurrent: 0, maxTotal: 0, maxDepth: 0 })
  expect(narrowed.reviewerPolicy.mode).toBe('off'); expect(narrowed.budget).toEqual(root.budget)
  expect(Object.isFrozen(narrowed)).toBe(true)
})

test('delegation proposals cannot provide capabilities, extra fields or more than two children', () => {
  const proposal = (value: unknown) => `<islemind_delegate>${JSON.stringify(value)}</islemind_delegate>`
  const task = { agentId: 'child', task: 'independent fact check' }
  expect(parseDelegation([], proposal({ tasks: [task] }))?.tasks).toEqual([task])
  for (const value of [{ tasks: [task, task, task] }, { tasks: [{ ...task, allowedTools: ['write'] }] }, { tasks: [task], approved: true }, { tasks: [] }]) {
    expect(() => parseDelegation([], proposal(value))).toThrow()
  }
  expect(() => parseDelegation([{ callId: 'one', name: 'write', arguments: {} }], proposal({ tasks: [task] }))).toThrow()
})

test('durable delegation counters fail closed rather than resetting invalid or unknown children', () => {
  const child = { runId: 'child', agentId: 'reader', role: 'delegate' }
  expect(decodeDelegation({ children: [child], reviewCount: 0, reworkCount: 0 }).children).toHaveLength(1)
  for (const value of [
    { children: [child, child], reviewCount: 0, reworkCount: 0 },
    { children: [], reviewCount: 1, reworkCount: 0 },
    { children: [child], reviewCount: 0, reworkCount: 3 },
    { children: [{ ...child, role: 'admin' }], reviewCount: 0, reworkCount: 0 },
  ]) expect(() => decodeDelegation(value)).toThrow()
})
