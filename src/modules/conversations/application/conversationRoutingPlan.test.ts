import { applyConversationModelPreference } from './conversationModelPreference'
import { parseConversationSnapshot } from '../domain/conversationSnapshot'
import { createConversationBranchDraft } from './conversationBranch'
import { normalizeSettingsIdentityPreferences, sanitizeSettingsForPortableExport } from '@/modules/settings'
import { isUsageExecutionReference } from '@/core/usageExecution'
import type { Conversation } from '@/types/chatContracts'
import type { Settings } from '@/types/settingsContracts'
import type { ModelRoutingPlan } from '@/core/modelRoutingPlan'

const plan: ModelRoutingPlan = { schema: 'islemind.model-routing-plan.v1', id: 'plan', name: 'Stable', mode: 'fallback',
  primary: { providerId: 'a', model: 'first' }, backup: { providerId: 'b', model: 'second' }, crossProvider: 'ask' }
const conversation: Conversation = { id: 'c', providerId: 'a', model: 'first', title: 'c', systemPrompt: '', temperature: 1,
  maxTokens: 1024, createdAt: 1, updatedAt: 1, messages: [{ id: 'reply', role: 'assistant', content: 'hi', status: 'done', timestamp: 1 }] }

it('persists a plan snapshot, restores it and isolates it from future template edits', () => {
  const template = structuredClone(plan)
  const selected = applyConversationModelPreference(conversation, { ...plan.primary, routingPlan: template }, 2)
  template.name = 'edited'
  template.backup!.model = 'different'
  expect(parseConversationSnapshot(JSON.parse(JSON.stringify(selected)))?.routingPlan).toEqual(plan)
  expect(createConversationBranchDraft(selected, 'reply', { id: 'branch', title: 'Branch', now: 3 })?.routingPlan).toEqual(plan)
  expect(applyConversationModelPreference(selected, plan.primary, 3).routingPlan).toBeUndefined()
})

it('rejects a saved plan with mismatched primary or unknown versions without silently using another route', () => {
  expect(parseConversationSnapshot({ ...conversation, routingPlan: { ...plan, schema: 'v99' } })).toBeUndefined()
  expect(parseConversationSnapshot({ ...conversation, model: 'different', routingPlan: plan })).toBeUndefined()
  expect(() => applyConversationModelPreference(conversation, { providerId: 'other', model: 'first', routingPlan: plan }, 2)).toThrow()
})

it('includes plans in normalized portable settings and retains explicit empty collections', () => {
  const settings = { modelRoutingPlans: [plan] } as Settings
  expect(normalizeSettingsIdentityPreferences(settings).modelRoutingPlans).toEqual([plan])
  expect(sanitizeSettingsForPortableExport(settings).modelRoutingPlans).toEqual([plan])
  expect(sanitizeSettingsForPortableExport({} as Settings).modelRoutingPlans).toEqual([])
  expect(() => normalizeSettingsIdentityPreferences({ modelRoutingPlans: [{ ...plan, schema: 'bad' }] } as unknown as Settings)).toThrow()
})

it('validates request plan attribution and rejects secret-bearing or oversized receipts', () => {
  const execution = { schema: 'islemind.request-execution.v1', logicalRequestId: 'r', requestStartedAt: 1,
    routingPlan: { id: 'plan', name: 'Stable', primaryProviderId: 'a', primaryModel: 'first' } }
  expect(isUsageExecutionReference(execution)).toBe(true)
  expect(isUsageExecutionReference({ ...execution, routingPlan: { ...execution.routingPlan, apiKey: 'secret' } })).toBe(false)
  expect(isUsageExecutionReference({ ...execution, routingPlan: { ...execution.routingPlan, name: 'x'.repeat(81) } })).toBe(false)
})
