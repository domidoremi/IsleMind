import type { ProcessTrace, StreamEvent } from '@/core'
import {
  createAssistantMcpToolTurnRuntime,
  type AssistantTaggedToolManifestLike,
} from '@/modules/assistant-runtime'
import type { ProviderRuntimeCompletionResult } from '@/modules/providers'
import {
  BUILT_IN_CAPABILITY_SERVER_ID,
  parseMcpToolRequest,
  type ResolvedMcpConversationTool,
} from '@/modules/integrations'
import { buildWorkflowToolCallTraceMetadata } from '@/bootstrap/workflowToolCallTrace'
import { shouldExposeLocalSearchTool } from '@/bootstrap/workflowSearchToolAdmission'
import { executeExternalTaskBoundTool } from '@/bootstrap/taskBoundToolRuntime'
import { buildPendingAction, formatPendingActionOutput } from '@/bootstrap/workflowPendingAction'
import { truncateToolBlocks } from '@/bootstrap/mcpExecutionRuntime'
import { resolveConversationGenerationParameterRequest } from '@/bootstrap/providerConversationGeneration'
import { streamProviderChat } from '@/bootstrap/providerRuntime'
import { createRichStreamEventReporter } from '@/bootstrap/conversationProviderStreamingRuntime'
import { resolveWorkflowRunLimitsFromSettings } from '@/modules/tasks'
import {
  buildMcpToolRevisionMessages,
  buildMcpToolRevisionSystemPrompt,
} from '@/services/chatMcpRevisionUtils'
import { completeTrace, sanitizeTrace } from '@/services/chatTraceUtils'
import {
  findMcpTool,
  formatToolBlocks,
  sanitizeToolRevisionAnswerText,
} from '@/services/chatToolResultUtils'
import { useChatStore } from '@/store/chatStore'
import { useChatStreamingStore } from '@/store/chatStreamingStore'
import { useSettingsStore } from '@/store/settingsStore'
import type { Conversation } from '@/types/chatContracts'
import type { McpServerConfig } from '@/types/mcpContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'
import { resolveProviderModelAlias } from '@/utils/providerModels'
import { st } from '@/i18n/service'

type McpToolUsage = ProviderRuntimeCompletionResult['usage']
type ResolvedMcpTool = ResolvedMcpConversationTool<McpServerConfig>
type ResolvedTaggedTool = ResolvedMcpTool & {
  manifest?: AssistantTaggedToolManifestLike
}

export function createConversationMcpToolTurnRuntime(input: {
  conversationId: string
  assistantMessageId: string
  onStreamEvent?: (event: StreamEvent) => void
}) {
  return createAssistantMcpToolTurnRuntime<
    AIProvider,
    Settings,
    McpToolUsage,
    ResolvedTaggedTool
  >({
    parseRequest: parseMcpToolRequest,
    findTool(tools, request, manifests) {
      const selected = findMcpTool([...tools], request)
      if (selected) {
        const manifest = findTaggedToolManifest(manifests, {
          serverId: selected.server.id,
          toolName: selected.tool.name,
        }) ?? manifestFromResolvedTool(selected)
        return isAdmittedTaggedTool(manifest)
          ? { ...selected, manifest }
          : undefined
      }
      const manifest = findTaggedToolManifest(manifests, request)
      return manifest && isAdmittedTaggedTool(manifest)
        ? resolvedToolFromManifest(manifest)
        : undefined
    },
    getSettings() {
      return useSettingsStore.getState().settings
    },
    resolveLimits: resolveWorkflowRunLimitsFromSettings,
    buildRuntimeLogOptions(settings) {
      return { enabled: settings.runtimeLogEnabled, maxBytes: settings.runtimeLogMaxBytes }
    },
    async executeTask(taskInput) {
      return executeExternalTaskBoundTool(
        taskInput as Parameters<typeof executeExternalTaskBoundTool>[0],
      )
    },
    buildPendingActionProjection(projectionInput) {
      const pendingAction = buildPendingAction(
        projectionInput.runId,
        projectionInput.goal,
        projectionInput.step,
      )
      if (!pendingAction) return undefined
      return {
        pendingAction,
        output: formatPendingActionOutput(
          pendingAction,
          projectionInput.step.observation.output,
        ),
      }
    },
    truncateBlocks(blocks) {
      return truncateToolBlocks(blocks)
    },
    formatBlocks(blocks) {
      return formatToolBlocks([...blocks])
    },
    buildRevisionSystemPrompt: buildMcpToolRevisionSystemPrompt,
    buildRevisionMessages(revisionInput) {
      return buildMcpToolRevisionMessages(
        revisionInput as unknown as Parameters<typeof buildMcpToolRevisionMessages>[0],
      )
    },
    resolveGenerationParameters(parameterInput) {
      const conversation = parameterInput.conversation as Conversation
      return resolveConversationGenerationParameterRequest({
        provider: parameterInput.provider,
        conversation,
        settings: parameterInput.settings,
        model: resolveProviderModelAlias(parameterInput.provider, conversation.model),
        temperatureCap: parameterInput.temperatureCap,
      })
    },
    synthesize: (request) => synthesizeMcpToolAnswer(request, input.onStreamEvent),
    sanitizeAnswer: sanitizeToolRevisionAnswerText,
    translate: st,
    buildTraceMetadata(metadataInput) {
      return buildWorkflowToolCallTraceMetadata(
        metadataInput as unknown as Parameters<typeof buildWorkflowToolCallTraceMetadata>[0],
      )
    },
    completeTrace,
    recordTrace(trace) {
      upsertMcpToolTrace(input, trace)
    },
    traceId: mcpToolTraceId,
    now: Date.now,
  })
}

function findTaggedToolManifest(
  manifests: readonly AssistantTaggedToolManifestLike[],
  request: { serverId?: string; toolName: string },
): AssistantTaggedToolManifestLike | undefined {
  const matches = manifests.filter((manifest) => {
    if (!manifest.enabled || manifest.name !== request.toolName) return false
    if (!request.serverId) return true
    return manifest.serverId === request.serverId
      || manifest.serverName === request.serverId
  })
  if (request.serverId) return matches[0]
  return matches.length === 1 ? matches[0] : undefined
}

function manifestFromResolvedTool(
  resolved: ResolvedMcpTool,
): AssistantTaggedToolManifestLike {
  const source = resolved.server.id === BUILT_IN_CAPABILITY_SERVER_ID
    ? 'builtin'
    : 'mcp'
  return {
    id: `${source}:${resolved.server.id}:${resolved.tool.name}`,
    source,
    name: resolved.tool.name,
    description: resolved.tool.description ?? resolved.tool.name,
    permission: resolved.tool.permission,
    inputSchema: resolved.tool.inputSchema,
    enabled: resolved.server.enabled
      && resolved.tool.enabled
      && resolved.server.status === 'connected',
    serverId: resolved.server.id,
    serverName: resolved.server.name,
    requiresConfirmation: resolved.tool.permission === 'destructive',
  }
}

function resolvedToolFromManifest(
  manifest: AssistantTaggedToolManifestLike,
): ResolvedTaggedTool {
  const serverId = manifest.serverId ?? manifest.source
  const tool = {
    name: manifest.name,
    description: manifest.description,
    inputSchema: manifest.inputSchema,
    permission: manifest.permission,
    serverId,
    enabled: manifest.enabled,
  }
  return {
    server: {
      id: serverId,
      name: manifest.serverName ?? serverId,
      url: `${manifest.source}://tagged-tool`,
      transport: 'sse',
      enabled: manifest.enabled,
      status: manifest.enabled ? 'connected' : 'disconnected',
      manifestTtlMs: 1,
      tools: [tool],
      resources: [],
      prompts: [],
      approvedToolNames: [manifest.name],
      createdAt: 0,
      updatedAt: 0,
    },
    tool,
    manifest,
  }
}

function isAdmittedTaggedTool(manifest: AssistantTaggedToolManifestLike): boolean {
  if (!manifest.enabled) return false
  if (manifest.source !== 'builtin' || manifest.name !== 'search_web') return true
  return shouldExposeLocalSearchTool(useSettingsStore.getState().settings)
}

async function synthesizeMcpToolAnswer(
  request: Record<string, unknown>,
  onStreamEvent?: (event: StreamEvent) => void,
) {
  let text = ''
  let usage: McpToolUsage
  let failure: Error | null = null
  const providerRequest = { ...request }
  delete providerRequest.onStreamEvent
  const provider = providerRequest.provider
  const providerId = provider && typeof provider === 'object' && !Array.isArray(provider)
    ? (provider as { id?: unknown }).id
    : undefined
  const model = providerRequest.model
  const binding = typeof providerId === 'string' && providerId.trim()
    && typeof model === 'string' && model.trim()
    ? { providerId: providerId.trim(), model: model.trim() }
    : undefined
  const reporter = createRichStreamEventReporter(onStreamEvent, {
    ...(binding ? { binding } : {}),
  })
  const handle = await streamProviderChat(
    providerRequest as unknown as Parameters<typeof streamProviderChat>[0],
    (chunk) => {
      text += chunk
      reporter.text(chunk)
    },
    (result) => {
      const streamedText = text
      text = result.text || text
      usage = result.usage
      if (result.text && !streamedText) reporter.text(result.text)
      reporter.complete(result)
    },
    (error) => {
      failure = error
    },
    (citations) => {
      reporter.citations(citations)
    },
    (trace) => {
      reporter.trace(trace)
    },
  )
  await handle.done
  if (failure) throw failure
  return { text, usage }
}

function upsertMcpToolTrace(
  input: { conversationId: string; assistantMessageId: string },
  trace: ProcessTrace,
) {
  const projected = trace.status === 'running' ? trace : completeTrace(trace)
  const safeTrace = sanitizeTrace(projected)
  const streamingStore = useChatStreamingStore.getState()
  if (streamingStore.activeStreams.get(`${input.conversationId}:${input.assistantMessageId}`) === true) {
    streamingStore.upsertTrace(input.conversationId, input.assistantMessageId, safeTrace)
    return
  }
  useChatStore.getState().upsertMessageTrace(input.conversationId, input.assistantMessageId, safeTrace)
}

function mcpToolTraceId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
