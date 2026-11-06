import type { ConversationResourceScopeOverride, ConversationScenePlanSource } from '@/core'

export function normalizeConversationResourceScope(value: unknown): ConversationResourceScopeOverride | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const item = value as Record<string, unknown>
  if (item.schema !== 'islemind.conversation-resource-scope.v1'
    || Object.keys(item).some(key => !['schema', 'tools', 'knowledge'].includes(key))
    || ['tools', 'knowledge'].some(key => item[key] !== undefined && item[key] !== 'selected' && item[key] !== 'none')
    || item.tools === undefined && item.knowledge === undefined) return undefined
  return { schema: 'islemind.conversation-resource-scope.v1',
    ...(item.tools ? { tools: item.tools as 'selected' | 'none' } : {}),
    ...(item.knowledge ? { knowledge: item.knowledge as 'selected' | 'none' } : {}) }
}

export function normalizeConversationScenePlanSource(value: unknown): ConversationScenePlanSource | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const item = value as Record<string, unknown>
  if (Object.keys(item).some(key => !['schema', 'id', 'name', 'revision', 'appliedAt'].includes(key))
    || item.schema !== 'islemind.conversation-scene-plan.v1'
    || !validText(item.id, 120) || !validText(item.name, 80) || !Number.isSafeInteger(item.revision) || (item.revision as number) < 1
    || typeof item.appliedAt !== 'number' || !Number.isFinite(item.appliedAt) || item.appliedAt < 0) return undefined
  return { schema: 'islemind.conversation-scene-plan.v1', id: item.id, name: item.name,
    revision: item.revision as number, appliedAt: item.appliedAt }
}

function validText(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limit && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value)
}
