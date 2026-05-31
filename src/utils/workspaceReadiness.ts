import type { AIProvider, SearchProviderId, Settings } from '@/types'
import { resolveSearchProvider } from '@/services/searchPolicy'
import { isProviderConversationReady } from '@/utils/providerModels'

export type WorkspaceReadinessStatus = 'ready' | 'action' | 'review'
export type WorkspaceReadinessKey = 'provider' | 'memory' | 'knowledge' | 'search' | 'recovery'

export interface WorkspaceReadinessContextHealth {
  loading?: boolean
  memoryCount?: number
  activeMemoryCount?: number
  pendingMemoryCount?: number
  knowledgeDocumentCount?: number
  knowledgeChunkCount?: number
  failedKnowledgeDocumentCount?: number
}

export type WorkspaceReadinessItem =
  | { key: 'provider'; status: WorkspaceReadinessStatus; metrics: { readyProviders: number } }
  | { key: 'memory'; status: WorkspaceReadinessStatus; metrics: Pick<WorkspaceReadinessContextHealth, 'loading' | 'memoryCount' | 'activeMemoryCount' | 'pendingMemoryCount'> }
  | { key: 'knowledge'; status: WorkspaceReadinessStatus; metrics: Pick<WorkspaceReadinessContextHealth, 'loading' | 'knowledgeDocumentCount' | 'knowledgeChunkCount' | 'failedKnowledgeDocumentCount'> }
  | { key: 'search'; status: WorkspaceReadinessStatus; metrics: { searchProvider: SearchProviderId } }
  | { key: 'recovery'; status: WorkspaceReadinessStatus }

export interface WorkspaceReadinessSummary {
  items: WorkspaceReadinessItem[]
  readyCount: number
  totalCount: number
  primaryAction: WorkspaceReadinessItem | null
}

const readinessActionPriority: Record<WorkspaceReadinessKey, number> = {
  provider: 0,
  knowledge: 1,
  memory: 2,
  search: 3,
  recovery: 4,
}

export function buildWorkspaceReadiness(input: {
  providers: AIProvider[]
  settings: Settings
  contextHealth?: WorkspaceReadinessContextHealth
}): WorkspaceReadinessSummary {
  const readyProviders = input.providers.filter((provider) => isProviderConversationReady(provider)).length
  const searchProvider = resolveSearchProvider(input.settings)
  const knowledgeReady = input.settings.knowledgeEnabled === true && (input.settings.ragMode ?? 'hybrid') !== 'off'
  const memoryMetrics = {
    loading: input.contextHealth?.loading,
    memoryCount: input.contextHealth?.memoryCount,
    activeMemoryCount: input.contextHealth?.activeMemoryCount,
    pendingMemoryCount: input.contextHealth?.pendingMemoryCount,
  }
  const knowledgeMetrics = {
    loading: input.contextHealth?.loading,
    knowledgeDocumentCount: input.contextHealth?.knowledgeDocumentCount,
    knowledgeChunkCount: input.contextHealth?.knowledgeChunkCount,
    failedKnowledgeDocumentCount: input.contextHealth?.failedKnowledgeDocumentCount,
  }
  const items: WorkspaceReadinessItem[] = [
    {
      key: 'provider',
      status: readyProviders > 0 ? 'ready' : 'action',
      metrics: { readyProviders },
    },
    {
      key: 'memory',
      status: memoryReadinessStatus(input.settings, memoryMetrics),
      metrics: memoryMetrics,
    },
    {
      key: 'knowledge',
      status: knowledgeReadinessStatus(knowledgeReady, knowledgeMetrics),
      metrics: knowledgeMetrics,
    },
    {
      key: 'search',
      status: searchProvider !== 'off' ? 'ready' : 'review',
      metrics: { searchProvider },
    },
    {
      key: 'recovery',
      status: input.settings.autoUpdateCheckEnabled ?? true ? 'ready' : 'review',
    },
  ]
  return {
    items,
    readyCount: items.filter((item) => item.status === 'ready').length,
    totalCount: items.length,
    primaryAction: selectPrimaryReadinessAction(items),
  }
}

function selectPrimaryReadinessAction(items: WorkspaceReadinessItem[]): WorkspaceReadinessItem | null {
  const candidates = items.filter((item) => item.status !== 'ready')
  if (!candidates.length) return null
  return candidates.reduce((best, item) => readinessActionRank(item) < readinessActionRank(best) ? item : best)
}

function readinessActionRank(item: WorkspaceReadinessItem): number {
  const statusRank = item.status === 'action' ? 0 : 100
  return statusRank + readinessActionPriority[item.key]
}

function memoryReadinessStatus(
  settings: Settings,
  metrics: Pick<WorkspaceReadinessContextHealth, 'loading' | 'activeMemoryCount'>
): WorkspaceReadinessStatus {
  if (!settings.memoryEnabled) return 'action'
  if (metrics.loading || metrics.activeMemoryCount === undefined) return 'review'
  return metrics.activeMemoryCount > 0 ? 'ready' : 'review'
}

function knowledgeReadinessStatus(
  enabled: boolean,
  metrics: Pick<WorkspaceReadinessContextHealth, 'loading' | 'knowledgeDocumentCount' | 'knowledgeChunkCount' | 'failedKnowledgeDocumentCount'>
): WorkspaceReadinessStatus {
  if (!enabled) return 'action'
  if (metrics.loading || metrics.knowledgeDocumentCount === undefined || metrics.knowledgeChunkCount === undefined) return 'review'
  if ((metrics.failedKnowledgeDocumentCount ?? 0) > 0) return 'review'
  return metrics.knowledgeDocumentCount > 0 && metrics.knowledgeChunkCount > 0 ? 'ready' : 'review'
}
