import type { ProcessTrace } from '@/core'
import {
  createMcpConversationContextPolicy,
  type McpConversationContextOutcome,
  type McpConversationContextTracePlan,
  type ResolvedMcpConversationTool,
} from '@/modules/integrations'
import { listMcpServers } from '@/bootstrap/mcpCatalog'
import { completeTrace } from '@/services/chatTraceUtils'
import { st } from '@/i18n/service'
import type { Conversation } from '@/types/chatContracts'
import type { McpServerConfig } from '@/types/mcpContracts'

export type ConversationResolvedMcpTool = ResolvedMcpConversationTool<McpServerConfig>

export type ConversationMcpContextResolution = McpConversationContextOutcome<McpServerConfig> & {
  readonly traces: readonly ProcessTrace[]
}

const conversationMcpContextPolicy = createMcpConversationContextPolicy<McpServerConfig>({
  listServers(options) {
    return listMcpServers(options)
  },
  now: Date.now,
})

export async function resolveConversationMcpContext(input: {
  readonly conversation: Conversation
  readonly mcpEnabled: boolean
  readonly toolCallTag: string
  readonly signal: AbortSignal
  readonly traceId: (prefix: string) => string
}): Promise<ConversationMcpContextResolution> {
  const outcome = await conversationMcpContextPolicy.resolve({
    mcpEnabled: input.mcpEnabled,
    enabledTools: input.conversation.enabledTools,
    skillSnapshot: input.conversation.skillSnapshot,
    toolCallTag: input.toolCallTag,
    signal: input.signal,
  })
  if (outcome.kind === 'cancelled' || outcome.kind === 'failed') {
    return { ...outcome, traces: [] }
  }
  return {
    ...outcome,
    traces: [projectMcpConversationContextTrace(outcome.tracePlan, input.traceId)],
  }
}

export const conversationMcpContextRuntime = {
  resolveConversationMcpContext,
}

function projectMcpConversationContextTrace(
  plan: McpConversationContextTracePlan,
  traceId: (prefix: string) => string,
): ProcessTrace {
  if (plan.kind === 'disabled') {
    return completeTrace({
      id: traceId(plan.idPrefix),
      type: plan.type,
      title: st('chatRunner.trace.mcpTitle'),
      content: st('chatRunner.trace.mcpDisabled'),
      status: plan.status,
      startedAt: plan.startedAt,
    })
  }
  if (plan.kind === 'empty') {
    return completeTrace({
      id: traceId(plan.idPrefix),
      type: plan.type,
      title: st('chatRunner.trace.mcpTitle'),
      content: st('chatRunner.trace.mcpNoTools'),
      status: plan.status,
      startedAt: plan.startedAt,
    })
  }
  return completeTrace({
    id: traceId(plan.idPrefix),
    type: plan.type,
    title: st('chatRunner.trace.mcpManifestTitle'),
    content: [
      plan.connectedCount
        ? st('chatRunner.trace.mcpConnectedTools', {
          count: plan.connectedCount,
          tools: plan.connectedToolLabels.join(', '),
        })
        : st('chatRunner.trace.mcpNoOnlineTools'),
      plan.offlineCount
        ? st('chatRunner.trace.mcpOfflineTools', {
          count: plan.offlineCount,
          tools: plan.offlineToolLabels.join(', '),
        })
        : '',
    ].filter(Boolean).join('\n'),
    status: plan.status,
    startedAt: plan.startedAt,
    metadata: {
      connected: plan.connectedCount,
      offline: plan.offlineCount,
    },
  })
}
