/** Navigation metadata only: never put configuration values or credentials here. */
export const SETTINGS_CATEGORIES = ['models', 'knowledge', 'tools', 'personalization', 'privacy', 'maintenance'] as const
export type SettingsCategory = typeof SETTINGS_CATEGORIES[number]
export interface SettingsDestination {
  id: string
  category: SettingsCategory
  titleKey: string
  route: string
  section?: string
  parentSection?: string
  fieldOnly?: boolean
  helpTopic: string
  keywords: readonly string[]
}
export const SETTINGS_DESTINATIONS: readonly SettingsDestination[] = [
  { id: 'providers', category: 'models', titleKey: 'settings.providers', route: '/settings/providers', helpTopic: 'models', keywords: ['API token key endpoint 服务商 密钥 接口 プロバイダー'] },
  { id: 'model-availability', category: 'models', titleKey: 'settings.models', route: '/settings/model-availability', helpTopic: 'models', keywords: ['model availability 模型 可用性 モデル'] },
  { id: 'generation', category: 'models', titleKey: 'preferences.generation', route: '/settings/preferences', section: 'generation', helpTopic: 'models', keywords: ['temperature tokens 温度 最大输出 生成参数 出力 トークン'] },
  { id: 'usage', category: 'models', titleKey: 'usage.title', route: '/settings/usage', helpTopic: 'usage', keywords: ['cost billing tokens 用量 费用 使用量 コスト'] },
  { id: 'context', category: 'knowledge', titleKey: 'settings.context', route: '/settings/context', helpTopic: 'search', keywords: ['RAG search retrieval profile 联网 搜索 检索 上下文 検索 コンテキスト'] },
  { id: 'knowledge', category: 'knowledge', titleKey: 'settings.knowledge', route: '/settings/knowledge', helpTopic: 'knowledge', keywords: ['documents import 知识 导入 ナレッジ 取り込み'] },
  { id: 'memory', category: 'knowledge', titleKey: 'settings.memory', route: '/settings/memory', helpTopic: 'knowledge', keywords: ['review memory 记忆 审核 メモリ 承認'] },
  { id: 'skills', category: 'tools', titleKey: 'settings.skills', route: '/settings/skills', helpTopic: 'tools', keywords: ['skill template 技能 模板 スキル'] },
  { id: 'mcp', category: 'tools', titleKey: 'settings.mcp', route: '/settings/mcp', section: 'mcp-add', helpTopic: 'tools', keywords: ['MCP server endpoint tools 工具 地址 サーバー ツール'] },
  { id: 'agents', category: 'tools', titleKey: 'settingsWorkspace.agents', route: '/settings/agents', helpTopic: 'tools', keywords: ['agent automation 自动化 智能体 エージェント'] },
  { id: 'workflow', category: 'tools', titleKey: 'preferences.agentWorkflow', route: '/settings/preferences', section: 'workflow', helpTopic: 'tools', keywords: ['workflow steps limits 工作流 步数 调用上限 ワークフロー'] },
  { id: 'appearance', category: 'personalization', titleKey: 'settingsWorkspace.appearance', route: '/settings/system/appearance', helpTopic: 'personalization', keywords: ['theme background language 主题 背景 语言 液态玻璃 テーマ 言語'] },
  { id: 'interaction', category: 'personalization', titleKey: 'preferences.interaction', route: '/settings/preferences', section: 'interaction', helpTopic: 'personalization', keywords: ['haptics command 触感 快捷键 交互 操作'] },
  { id: 'identity', category: 'personalization', titleKey: 'preferences.identity', route: '/settings/preferences', section: 'identity', helpTopic: 'personalization', keywords: ['name assistant 名称 助手 名前'] },
  { id: 'notifications', category: 'personalization', titleKey: 'settingsWorkspace.notifications', route: '/settings/system/advanced', helpTopic: 'personalization', keywords: ['system notifications 系统 通知'] },
  { id: 'data', category: 'privacy', titleKey: 'settingsWorkspace.backup', route: '/settings/system/data', helpTopic: 'privacy', keywords: ['backup restore export import JSON 备份 恢复 导入 导出 復元'] },
  { id: 'governance', category: 'privacy', titleKey: 'settingsWorkspace.governance', route: '/settings/system/governance', helpTopic: 'privacy', keywords: ['access log proxy upstream permission 安全 代理 权限 日志 プロキシ 権限'] },
  { id: 'danger', category: 'privacy', titleKey: 'settingsWorkspace.danger', route: '/settings/system/danger', helpTopic: 'privacy', keywords: ['delete reset 清除 删除 重置 削除 リセット'] },
  { id: 'help', category: 'maintenance', titleKey: 'settingsWorkspace.manual', route: '/help', helpTopic: 'quick-start', keywords: ['help guide manual 使用手册 说明 ヘルプ ガイド'] },
  { id: 'diagnostics', category: 'maintenance', titleKey: 'settingsWorkspace.diagnostics', route: '/settings/system/diagnostics', helpTopic: 'troubleshooting', keywords: ['diagnostics repair 诊断 修复 診断 修復'] },
  { id: 'updates', category: 'maintenance', titleKey: 'settingsWorkspace.updates', route: '/settings/system/updates', helpTopic: 'troubleshooting', keywords: ['update version 更新 版本 アップデート'] },
  {"id":"governance.transportMode","category":"privacy","titleKey":"settings.transportMode","route":"/settings/system/governance","section":"governance.transportMode","parentSection":"routing","fieldOnly":true,"helpTopic":"privacy","keywords":["transportMode","routing"]},
  {"id":"governance.remoteCompactMode","category":"privacy","titleKey":"settings.remoteCompactMode","route":"/settings/system/governance","section":"governance.remoteCompactMode","parentSection":"routing","fieldOnly":true,"helpTopic":"privacy","keywords":["remoteCompactMode","routing"]},
  {"id":"governance.remoteCompactThreshold","category":"privacy","titleKey":"settings.remoteCompactThreshold","route":"/settings/system/governance","section":"governance.remoteCompactThreshold","parentSection":"routing","fieldOnly":true,"helpTopic":"privacy","keywords":["remoteCompactThreshold","routing"]},
  {"id":"governance.remoteCompactThresholdTokens","category":"privacy","titleKey":"settings.remoteCompactThresholdTokens","route":"/settings/system/governance","section":"governance.remoteCompactThresholdTokens","parentSection":"routing","fieldOnly":true,"helpTopic":"privacy","keywords":["remoteCompactThresholdTokens","routing"]},
  {"id":"governance.payloadPolicyMode","category":"privacy","titleKey":"settings.payloadPolicyMode","route":"/settings/system/governance","section":"governance.payloadPolicyMode","parentSection":"routing","fieldOnly":true,"helpTopic":"privacy","keywords":["payloadPolicyMode","routing"]},
  {"id":"governance.proxyMode","category":"privacy","titleKey":"settings.proxyMode","route":"/settings/system/governance","section":"governance.proxyMode","parentSection":"routing","fieldOnly":true,"helpTopic":"privacy","keywords":["proxyMode","routing"]},
  {"id":"governance.proxyBaseUrl","category":"privacy","titleKey":"settings.proxyBaseUrl","route":"/settings/system/governance","section":"governance.proxyBaseUrl","parentSection":"routing","fieldOnly":true,"helpTopic":"privacy","keywords":["proxyBaseUrl","routing"]},
  {"id":"governance.observabilitySinkMode","category":"privacy","titleKey":"settings.observabilitySinkMode","route":"/settings/system/governance","section":"governance.observabilitySinkMode","parentSection":"observability","fieldOnly":true,"helpTopic":"privacy","keywords":["observabilitySinkMode","observability"]},
  {"id":"governance.observabilitySinkTarget","category":"privacy","titleKey":"settings.observabilitySinkTarget","route":"/settings/system/governance","section":"governance.observabilitySinkTarget","parentSection":"observability","fieldOnly":true,"helpTopic":"privacy","keywords":["observabilitySinkTarget","observability"]},
  {"id":"governance.observabilitySinkEndpointUrl","category":"privacy","titleKey":"settings.observabilitySinkEndpointUrl","route":"/settings/system/governance","section":"governance.observabilitySinkEndpointUrl","parentSection":"observability","fieldOnly":true,"helpTopic":"privacy","keywords":["observabilitySinkEndpointUrl","observability"]},
  {"id":"governance.observabilitySinkHighFrequencyMode","category":"privacy","titleKey":"settings.observabilitySinkHighFrequencyMode","route":"/settings/system/governance","section":"governance.observabilitySinkHighFrequencyMode","parentSection":"observability","fieldOnly":true,"helpTopic":"privacy","keywords":["observabilitySinkHighFrequencyMode","observability"]},
  {"id":"governance.observabilitySinkAttributeLimit","category":"privacy","titleKey":"settings.observabilitySinkAttributeLimit","route":"/settings/system/governance","section":"governance.observabilitySinkAttributeLimit","parentSection":"observability","fieldOnly":true,"helpTopic":"privacy","keywords":["observabilitySinkAttributeLimit","observability"]},
  {"id":"governance.observabilitySinkAttributeStringLimit","category":"privacy","titleKey":"settings.observabilitySinkAttributeStringLimit","route":"/settings/system/governance","section":"governance.observabilitySinkAttributeStringLimit","parentSection":"observability","fieldOnly":true,"helpTopic":"privacy","keywords":["observabilitySinkAttributeStringLimit","observability"]},
  {"id":"governance.observabilitySinkApiKey","category":"privacy","titleKey":"settings.observabilitySinkApiKey","route":"/settings/system/governance","section":"governance.observabilitySinkApiKey","parentSection":"observability","fieldOnly":true,"helpTopic":"privacy","keywords":["observabilitySinkApiKey","observability"]},
  {"id":"governance.sessionConcurrencyLimit","category":"privacy","titleKey":"settings.sessionConcurrencyLimit","route":"/settings/system/governance","section":"governance.sessionConcurrencyLimit","parentSection":"runtimeLimits","fieldOnly":true,"helpTopic":"privacy","keywords":["sessionConcurrencyLimit","runtimeLimits"]},
  {"id":"governance.sessionQueueTimeoutMs","category":"privacy","titleKey":"settings.sessionQueueTimeoutMs","route":"/settings/system/governance","section":"governance.sessionQueueTimeoutMs","parentSection":"runtimeLimits","fieldOnly":true,"helpTopic":"privacy","keywords":["sessionQueueTimeoutMs","runtimeLimits"]},
  {"id":"governance.sessionAffinityTtlMs","category":"privacy","titleKey":"settings.sessionAffinityTtlMs","route":"/settings/system/governance","section":"governance.sessionAffinityTtlMs","parentSection":"runtimeLimits","fieldOnly":true,"helpTopic":"privacy","keywords":["sessionAffinityTtlMs","runtimeLimits"]},
  {"id":"governance.upstreamRequestTimeoutMs","category":"privacy","titleKey":"settings.upstreamRequestTimeoutMs","route":"/settings/system/governance","section":"governance.upstreamRequestTimeoutMs","parentSection":"runtimeLimits","fieldOnly":true,"helpTopic":"privacy","keywords":["upstreamRequestTimeoutMs","runtimeLimits"]},
  {"id":"governance.upstreamMaxRetries","category":"privacy","titleKey":"settings.upstreamMaxRetries","route":"/settings/system/governance","section":"governance.upstreamMaxRetries","parentSection":"runtimeLimits","fieldOnly":true,"helpTopic":"privacy","keywords":["upstreamMaxRetries","runtimeLimits"]},
  {"id":"governance.upstreamCircuitBreakerFailureThreshold","category":"privacy","titleKey":"settings.upstreamCircuitBreakerFailureThreshold","route":"/settings/system/governance","section":"governance.upstreamCircuitBreakerFailureThreshold","parentSection":"runtimeLimits","fieldOnly":true,"helpTopic":"privacy","keywords":["upstreamCircuitBreakerFailureThreshold","runtimeLimits"]},
  {"id":"governance.upstreamCircuitBreakerCooldownMs","category":"privacy","titleKey":"settings.upstreamCircuitBreakerCooldownMs","route":"/settings/system/governance","section":"governance.upstreamCircuitBreakerCooldownMs","parentSection":"runtimeLimits","fieldOnly":true,"helpTopic":"privacy","keywords":["upstreamCircuitBreakerCooldownMs","runtimeLimits"]},
  {"id":"governance.cacheTtl","category":"privacy","titleKey":"settings.cacheTtl","route":"/settings/system/governance","section":"governance.cacheTtl","parentSection":"requestShaping","fieldOnly":true,"helpTopic":"privacy","keywords":["cacheTtl","requestShaping"]},
  {"id":"governance.runtimeLogMaxBytes","category":"privacy","titleKey":"settings.runtimeLogMaxBytes","route":"/settings/system/governance","section":"governance.runtimeLogMaxBytes","parentSection":"accessRules","fieldOnly":true,"helpTopic":"privacy","keywords":["runtimeLogMaxBytes","accessRules"]},
  {"id":"governance.providerAllowlist","category":"privacy","titleKey":"settings.providerAllowlist","route":"/settings/system/governance","section":"governance.providerAllowlist","parentSection":"accessRules","fieldOnly":true,"helpTopic":"privacy","keywords":["providerAllowlist","accessRules"]},
  {"id":"governance.providerBlocklist","category":"privacy","titleKey":"settings.providerBlocklist","route":"/settings/system/governance","section":"governance.providerBlocklist","parentSection":"accessRules","fieldOnly":true,"helpTopic":"privacy","keywords":["providerBlocklist","accessRules"]},
  {"id":"governance.modelAllowlist","category":"privacy","titleKey":"settings.modelAllowlist","route":"/settings/system/governance","section":"governance.modelAllowlist","parentSection":"accessRules","fieldOnly":true,"helpTopic":"privacy","keywords":["modelAllowlist","accessRules"]},
  {"id":"governance.modelBlocklist","category":"privacy","titleKey":"settings.modelBlocklist","route":"/settings/system/governance","section":"governance.modelBlocklist","parentSection":"accessRules","fieldOnly":true,"helpTopic":"privacy","keywords":["modelBlocklist","accessRules"]},
  {"id":"temperature","titleKey":"chat.temperature","section":"generation-temperature","keywords":["temperature 温度 sampling サンプリング"],"category":"models","route":"/settings/preferences","fieldOnly":true,"helpTopic":"models"},
  {"id":"max-tokens","titleKey":"chat.maxTokens","section":"generation-tokens","keywords":["max tokens output 输出上限 最大出力"],"category":"models","route":"/settings/preferences","fieldOnly":true,"helpTopic":"models"},
  { id: 'workflow-steps', category: 'tools', titleKey: 'preferences.agentWorkflowMaxSteps', route: '/settings/preferences', section: 'workflow-steps', parentSection: 'workflow', fieldOnly: true, helpTopic: 'tools', keywords: ['agentWorkflowMaxSteps max steps 步数 工作流 ワークフロー 最大ステップ'] },
  { id: 'workflow-tools', category: 'tools', titleKey: 'preferences.agentWorkflowMaxToolCalls', route: '/settings/preferences', section: 'workflow-tools', parentSection: 'workflow', fieldOnly: true, helpTopic: 'tools', keywords: ['agentWorkflowMaxToolCallsPerStep tool calls 工具调用上限 ツール呼び出し上限'] },
  { id: 'workflow-output', category: 'tools', titleKey: 'preferences.agentWorkflowOutputLimit', route: '/settings/preferences', section: 'workflow-output', parentSection: 'workflow', fieldOnly: true, helpTopic: 'tools', keywords: ['agentWorkflowOutputCharLimit workflow output 工作流 输出 字符数 出力文字数'] },
  {"id":"rag-profile","titleKey":"contextPanel.ragProfile","section":"rag-profile","keywords":["RAG fast balanced deep offline 检索 快速 均衡 深入 离线 オフライン"],"category":"knowledge","route":"/settings/context","fieldOnly":true,"helpTopic":"search"},
  { id: 'local-model-mirror', category: 'knowledge', titleKey: 'contextPanel.localModel.mirrorBaseUrl', route: '/settings/context', section: 'local-model-mirror', parentSection: 'rag-profile', fieldOnly: true, helpTopic: 'search', keywords: ['local model download mirror address URL 本地模型 下载 镜像地址 镜像源 ローカルモデル ダウンロード ミラーアドレス'] },
  {"id":"search-provider","titleKey":"settings.search","section":"search-provider","keywords":["tavily google bing search 联网搜索 検索エンジン"],"category":"knowledge","route":"/settings/context","fieldOnly":true,"helpTopic":"search"},
]

export function normalizeSettingsQuery(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase()
}
export function buildSettingsIndex(translate: (key: string) => string) {
  return SETTINGS_DESTINATIONS.map(entry => ({ ...entry, title: translate(entry.titleKey), searchText: normalizeSettingsQuery([translate(entry.titleKey), translate(`settingsWorkspace.categories.${entry.category}`), ...entry.keywords].join(' ')) }))
}
export function searchSettingsIndex<T extends { searchText: string }>(index: readonly T[], query: string): T[] {
  const words = normalizeSettingsQuery(query).split(/\s+/).filter(Boolean)
  return words.length ? index.filter(entry => words.every(word => entry.searchText.includes(word))) : []
}
export function settingsHelpTopic(pathname: string, section?: string): string {
  const destinations = SETTINGS_DESTINATIONS.filter(entry => entry.route === pathname)
  return destinations.find(entry => section && entry.section === section)?.helpTopic
    ?? destinations[0]?.helpTopic
    ?? 'quick-start'
}
