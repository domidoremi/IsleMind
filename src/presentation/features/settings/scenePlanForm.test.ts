import type { ScenePlan } from '@/core'
import type { ScenePlanCatalog } from './scenePlanWorkspacePort'
import { scenePlanFromForm, scenePlanToForm } from './scenePlanForm'

const plan: ScenePlan = { schema: 'islemind.scene-plan.v1', id: 'scene', name: 'Research', revision: 1, configuration: {} }
const catalog: ScenePlanCatalog = { tools: [], knowledge: [], skills: [], skillVariables: { s: [
  { name: 'count', type: 'number' }, { name: 'enabled', type: 'boolean' }, { name: 'topic', type: 'text' },
] } }

test('selected resources require a selection while none persists an explicit empty list', () => {
  const form = scenePlanToForm(plan, 0.8)
  form.resourceModes.enabledTools = 'selected'
  expect(scenePlanFromForm(form, catalog)).toBeUndefined()
  form.resourceModes.enabledTools = 'none'
  expect(scenePlanFromForm(form, catalog)?.configuration.enabledTools).toEqual([])
  form.resourceModes.enabledTools = 'keep'
  expect(scenePlanFromForm(form, catalog)?.configuration.enabledTools).toBeUndefined()
})

test.each(['', '.', '0', '9', '201', '65x'])('retains but rejects invalid threshold draft %s', text => {
  const form = scenePlanToForm({ ...plan, configuration: { contextPolicy: { schema: 'islemind.conversation-context-policy.v1', remoteCompactThreshold: 0.8 } } }, 0.8)
  form.thresholdText = text
  expect(scenePlanFromForm(form, catalog)).toBeUndefined()
  expect(form.thresholdText).toBe(text)
})

test('converts typed variable input only on save and rejects invalid numeric or boolean text', () => {
  const form = scenePlanToForm({ ...plan, configuration: { skillIds: ['s'] } }, 0.8)
  form.variableDrafts = { count: '2', enabled: 'false', topic: 'draft topic' }
  expect(scenePlanFromForm(form, catalog)?.configuration.skillVariables).toEqual({ count: 2, enabled: false, topic: 'draft topic' })
  form.variableDrafts.count = '2x'
  expect(scenePlanFromForm(form, catalog)).toBeUndefined()
  expect(form.variableDrafts.count).toBe('2x')
})

test('opening a form detaches template references and preserves threshold text across other edits', () => {
  const original: ScenePlan = { ...plan, configuration: { knowledgeSources: ['A'] } }
  const form = scenePlanToForm(original, 0.8)
  original.configuration.knowledgeSources!.push('B')
  expect(form.plan.configuration.knowledgeSources).toEqual(['A'])
  expect({ ...form, plan: { ...form.plan, name: 'Writing' } }.thresholdText).toBe('80')
})
