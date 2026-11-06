import type { Conversation } from '../src/types/chatContracts'
import type { ModelRoutingPlan } from '../src/core/modelRoutingPlan'
import { createScenePlansFixture } from './scene-plans-fixture'

/** Isolated I qualification data, with references beyond the first history page. */
export function createConnectionReferencesFixture() {
  const base = createScenePlansFixture()
  const now = Date.now()
  const primary = base.providers[0]
  const backup = base.providers[1]
  primary.name = '研究连接 A'
  backup.name = '备用连接 B'
  primary.models = ['gpt-4o-mini', 'gpt-4o']
  primary.manualModels = [...primary.models]
  const route = base.settings.modelRoutingPlans![0]
  const olderRoute: ModelRoutingPlan = {
    ...JSON.parse(JSON.stringify(route)), id: 'scene-older-route', name: '较早的主备配置',
    primary: { providerId: backup.id, model: 'gpt-4o-mini' }, backup: { providerId: primary.id, model: 'gpt-4o-mini' },
  }
  const conversations: Conversation[] = Array.from({ length: 81 }, (_, index) => ({
    id: index === 0 ? 'scene-existing' : `scene-history-${index.toString().padStart(3, '0')}`,
    title: index === 0 ? '当前研究会话' : index === 80 ? '较早的备用连接会话' : `保留的工作 ${index + 1}`,
    providerId: index < 40 ? primary.id : backup.id, model: 'gpt-4o-mini', providerModelMode: 'manual',
    ...(index === 0 ? { routingPlan: JSON.parse(JSON.stringify(route)) }
      : index === 80 ? { routingPlan: olderRoute } : {}),
    systemPrompt: 'Synthetic private configuration excluded from reference reports.',
    temperature: 0.6, maxTokens: 1024, createdAt: now - index * 1000, updatedAt: now - index * 1000,
    messages: [{ id: `scene-reference-message-${index}`, role: 'user', content: `保留原样的第 ${index + 1} 条历史内容。`,
      status: 'done', timestamp: now - index * 1000 }],
  }))
  return {
    ...base, schema: 'islemind.connection-references-fixture.v1',
    settings: { ...base.settings, modelFavorites: [
      { providerId: primary.id, modelId: 'gpt-4o-mini' }, { providerId: primary.id, modelId: 'gpt-4o' },
      { providerId: backup.id, modelId: 'gpt-4o-mini' },
    ], modelRoutingPlans: [route, {
      schema: 'islemind.model-routing-plan.v1' as const, id: 'scene-fixed-route', name: '固定备用连接',
      mode: 'fixed' as const, primary: { providerId: backup.id, model: 'gpt-4o-mini' }, crossProvider: 'ask' as const,
    }] },
    conversations,
    expected: {
      [primary.id]: { conversation: 41, routing: 1, scene: 1, default: 1, preferred: 1, favorite: 2 },
      [backup.id]: { conversation: 42, routing: 2, scene: 1, default: 0, preferred: 0, favorite: 1 },
      all: { conversation: 81, routing: 2, scene: 1, default: 1, preferred: 1, favorite: 3 },
    },
  }
}
