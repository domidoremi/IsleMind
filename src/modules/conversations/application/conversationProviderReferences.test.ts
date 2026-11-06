import type { ModelRoutingPlan } from '@/core'
import { projectConversationProviderReference } from './conversationProviderReferences'

const routingPlan: ModelRoutingPlan = { schema: 'islemind.model-routing-plan.v1', id: 'route', name: 'Route', mode: 'fallback',
  primary: { providerId: 'A', model: 'Alias' }, backup: { providerId: 'B', model: 'Model' }, crossProvider: 'ask' }
const conversation = { id: 'conversation', title: 'Work', providerId: 'A', model: 'Alias', routingPlan,
  messages: [{ content: 'Private history', providerId: 'historic-only' }], systemPrompt: 'Private prompt',
  scenePlanSource: { schema: 'islemind.conversation-scene-plan.v1', id: 'scene-template', name: 'Past application', revision: 1, appliedAt: 1 } }

it('finds an older conversation’s exact backup without counting messages or applied-scene provenance', () => {
  expect(projectConversationProviderReference(conversation, ['B'])).toEqual({
    unreadable: false, reference: { kind: 'conversation', id: 'conversation', label: 'Work',
      targets: [{ providerId: 'B', model: 'Model', role: 'backup' }] },
  })
  expect(projectConversationProviderReference(conversation, ['historic-only', 'scene-template'])).toEqual({ unreadable: false })
})

it('retains local drafts as unsent references, nullable preferences and independent role copies', () => {
  const result = projectConversationProviderReference(conversation, ['A'], true)
  expect(result.reference?.draft).toBe(true)
  expect(result.reference?.targets.map(target => target.role)).toEqual(['model', 'primary'])
  expect(projectConversationProviderReference({ id: 'unbound', providerId: null, model: null }, ['A'])).toEqual({ unreadable: false })
  expect(projectConversationProviderReference({ id: 'partial', providerId: 'A', model: null }, ['A']).reference?.targets)
    .toEqual([{ providerId: 'A', role: 'model' }])
  expect(JSON.stringify(result)).not.toMatch(/Private|scene-template|Past application/)
})

it.each([undefined, [], { id: '' }, { id: 'x', providerId: {} }, { id: 'x', providerId: 'A', model: 1 },
  { ...conversation, routingPlan: { ...routingPlan, schema: 'future' } }])('does not report malformed configuration as no references: %s', value => {
  expect(projectConversationProviderReference(value, ['A']).unreadable).toBe(true)
})
