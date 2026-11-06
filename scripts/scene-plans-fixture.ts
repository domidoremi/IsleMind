/** Bounded synthetic data for H qualification. No credentials or execution ports. */
import type { ModelRoutingPlan, ScenePlan } from '@/core'
import type { Conversation } from '@/types/chatContracts'
import type { KnowledgeChunkRecord, KnowledgeDocumentRecord } from '@/modules/knowledge'
import type { McpServerConfig } from '@/types/mcpContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'
import type { SkillDefinition } from '@/types/skillContracts'

export function createScenePlansFixture(now = Date.now()) {
  const providers: AIProvider[] = ['a', 'b'].map((id, index) => ({
    id: `scene-${id}`, name: index ? '备用连接 B' : '研究连接 A', type: 'openai-compatible',
    presetId: 'custom-endpoint', wireProtocol: 'openai-compatible',
    baseUrl: `https://scene-${id}.fixture.invalid/v1`, apiKey: '', enabled: true,
    models: ['gpt-4o-mini'], manualModels: ['gpt-4o-mini'], lastModelSyncStatus: 'ok',
  }))
  const route: ModelRoutingPlan = {
    schema: 'islemind.model-routing-plan.v1', id: 'scene-route', name: '研究主备',
    mode: 'fallback', primary: { providerId: 'scene-a', model: 'gpt-4o-mini' },
    backup: { providerId: 'scene-b', model: 'gpt-4o-mini' }, crossProvider: 'ask',
  }
  const skills: SkillDefinition[] = [{
    schema: 'islemind.skill.v1', id: 'scene-research-skill', name: '资料研究', layer: 'base',
    tags: ['research'], priority: 1, systemPrompt: '围绕 {{topic}} 整理资料，明确区分事实与推断。',
    variables: [{ name: 'topic', label: '研究主题', type: 'text', required: true, defaultValue: '产品设计' },
      { name: 'limit', label: '要点数量', type: 'number', defaultValue: 5 },
      { name: 'citations', label: '标注来源', type: 'boolean', defaultValue: true }],
    firstUserMessage: '这条技能消息需要用户主动发送。', createdAt: now, updatedAt: now,
  }]
  const mcpServers: McpServerConfig[] = [{
    id: 'scene-tools', name: '资料目录', url: 'https://scene-tools.fixture.invalid/mcp',
    transport: 'streamable-http', enabled: true, status: 'disconnected', manifestTtlMs: 86400000,
    manifestCachedAt: now, manifestExpiresAt: now + 86400000, approvedToolNames: ['read'],
    tools: [{ name: 'read', description: 'Synthetic source metadata only.', serverId: 'scene-tools',
      permission: 'read-only', enabled: true, inputSchema: { type: 'object', properties: {} } }],
    resources: [], prompts: [], createdAt: now, updatedAt: now,
  }]
  const documents: KnowledgeDocumentRecord[] = ['a', 'b'].map(id => ({
    schema: 'islemind.knowledge-document-record.v1',
    id: `scene-document-${id}`, title: '设计参考资料', mimeType: 'text/plain', size: 28,
    chunkCount: 1, status: 'ready', createdAt: now, updatedAt: now,
  }))
  const chunks: KnowledgeChunkRecord[] = documents.map(document => ({
    schema: 'islemind.knowledge-chunk-record.v1',
    id: `${document.id}-chunk`, documentId: document.id, title: document.title,
    content: `Synthetic isolated scene material ${document.id}.`, ordinal: 0, createdAt: now,
  }))
  const plans: ScenePlan[] = [{
    schema: 'islemind.scene-plan.v1', id: 'scene-research', name: '资料研究', revision: 1,
    description: '主备路由、技能变量与准确资源引用。',
    configuration: { model: { target: route.primary, routingPlan: route },
      skillIds: [skills[0].id], skillVariables: { topic: 'IsleMind 的功能与设计', limit: 5, citations: true },
      enabledTools: ['mcp:scene-tools:read'], knowledgeSources: documents.map(document => document.id),
      contextPolicy: { schema: 'islemind.conversation-context-policy.v1', remoteCompactThreshold: 0.65 },
      toolDeclarationMode: 'auto' },
  }, {
    schema: 'islemind.scene-plan.v1', id: 'scene-writing', name: '专注写作', revision: 1,
    description: '保留模型，关闭工具和知识范围。',
    configuration: { systemPrompt: '以简洁、清楚、自然的语言协助写作。'.repeat(25),
      enabledTools: [], knowledgeSources: [], contextPolicy: null, toolDeclarationMode: null },
  }, {
    schema: 'islemind.scene-plan.v1', id: 'scene-partial', name: '只调整上下文', revision: 1,
    description: '其余会话配置保持当前值。',
    configuration: { contextPolicy: { schema: 'islemind.conversation-context-policy.v1', remoteCompactThreshold: 0.7 } },
  }, {
    schema: 'islemind.scene-plan.v1', id: 'scene-missing', name: '待补全的方案', revision: 1,
    description: '用于核对缺失引用的阻止状态。',
    configuration: { model: { target: { providerId: 'scene-missing-provider', model: 'missing-model' } },
      skillIds: ['scene-missing-skill'], enabledTools: ['mcp:missing:read'], knowledgeSources: ['scene-missing-document'] },
  }]
  const conversations: Conversation[] = [{
    id: 'scene-existing', title: '保留历史的研究会话', providerId: 'scene-a', model: 'gpt-4o-mini',
    providerModelMode: 'manual', systemPrompt: '原有会话提示词', temperature: 0.6, maxTokens: 1024,
    enabledTools: [], knowledgeSources: [], createdAt: now, updatedAt: now,
    messages: [{ id: 'scene-original-message', role: 'user', content: '这条历史消息必须保持原内容。',
      status: 'done', timestamp: now }],
  }]
  const settings: Partial<Settings> = {
    themeId: 'minimal', theme: 'light', language: 'zh-CN', backgroundMotion: 'static',
    defaultProvider: 'scene-a', lastPreferredModel: { schema: 'islemind.global-model-preference.v1', providerId: 'scene-a', model: 'gpt-4o-mini' },
    autoUpdateCheckEnabled: false, webSearchEnabled: false,
    searchProvider: 'off', memoryEnabled: false, knowledgeEnabled: false, ragMode: 'fts',
    skillsEnabled: true, mcpEnabled: false, toolDeclarationMode: 'full', remoteCompactThreshold: 0.8,
    scenePlans: plans, modelRoutingPlans: [route],
  }
  return { schema: 'islemind.scene-plans-fixture.v1', synthetic: true, externalServicesUsed: false,
    providers, settings, skills, mcpServers, documents, chunks, conversations }
}
