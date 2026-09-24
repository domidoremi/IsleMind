import { createAgentDefinition } from '@/modules/assistant-runtime/agentDefinition'
import { agentDefinitionFromForm, agentDefinitionToForm } from './agentDefinitionForm'

const definition = () => createAgentDefinition({ id: 'agent', name: 'Research', providerId: 'provider', modelId: 'model' })

test('form round trips imported revisions, readonly review policy, limits and fractional minutes', () => {
  const source = { ...definition(), revision: 19, reviewerPolicy: { mode: 'read_only' as const, agentId: 'reviewer', maxReviews: 2 },
    budget: { ...definition().budget, activeMs: 1, amountUsd: 1e-8 }, knowledgeIds: ['knowledge-1'] }
  expect(agentDefinitionFromForm(agentDefinitionToForm(source))).toEqual(source)
})

test('reference parsing is strict and blank numeric inputs do not silently become zero', () => {
  const form = agentDefinitionToForm(definition())
  expect(agentDefinitionFromForm({ ...form, knowledgeIds: 'one, two\nthree' }).knowledgeIds).toEqual(['one', 'two', 'three'])
  for (const patch of [{ maxConcurrent: '' }, { modelRequests: '1junk' }, { tokens: 'Infinity' }, { knowledgeIds: 'same,same' }, { maxReviews: '3', reviewerMode: 'read_only' as const, reviewerAgentId: 'reviewer' }]) {
    expect(() => agentDefinitionFromForm({ ...form, ...patch })).toThrow()
  }
})
