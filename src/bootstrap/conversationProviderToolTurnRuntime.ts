import type { ProcessTrace } from '@/core'
import {
  createAssistantProviderToolTurnRuntime,
  type ProviderToolObservation,
  type ProviderToolRuntimeContext,
} from '@/modules/assistant-runtime'
import {
  createConversationRagRuntime,
  buildKnowledgeScope,
  type KnowledgeScope,
} from '@/modules/knowledge'
import type {
  ConversationToolCatalogManifest,
  ExternalToolObservation,
} from '@/modules/integrations'
import { stableIdentityHash } from '@/modules/integrations'
import type {
  ProviderNativeToolDeclarationResult,
  ProviderNativeToolNameMapEntry,
  ProviderRuntimeCompletionResult,
} from '@/modules/providers'
import { listConversationToolManifests } from '@/bootstrap/conversationToolCatalog'
import { filterProviderNativeChatToolManifests } from '@/bootstrap/workflowSearchToolAdmission'
import { executeExternalTaskBoundTool } from '@/bootstrap/taskBoundToolRuntime'
import { buildContextPlannerPrompt } from '@/bootstrap/contextPlanning'
import type { RetrievedConversationKnowledgeContext } from '@/bootstrap/knowledgeContextRuntime'
import {
  searchAgenticKnowledgeWithScope,
  searchKnowledgeWithFallback,
} from '@/bootstrap/knowledgeRetrievalRuntime'
import {
  buildProviderNativeToolDeclarations,
  resolveProviderNativeToolDeclarationTarget,
} from '@/bootstrap/providerNativeToolDeclarations'
import { resolveConversationGenerationParameterRequest } from '@/bootstrap/providerConversationGeneration'
import { conversationProviderGateway } from '@/bootstrap/conversationProviderGateway'
import {
  buildProviderNativeToolRevisionMessages,
  buildProviderNativeToolTraceMetadata,
  findProviderToolNameMapEntry,
  safeProviderNativeToolText,
} from '@/services/chatProviderNativeToolUtils'
import { isInternalChatDiagnosticOutput, providerToolSynthesisFailureMessage } from '@/services/chatInternalOutputGuard'
import { completeTrace, sanitizeTrace } from '@/services/chatTraceUtils'
import { formatToolBlocks, sanitizeToolRevisionAnswerText, stripMcpCallBlocks } from '@/services/chatToolResultUtils'
import { resolveWorkflowRunLimitsFromSettings } from '@/modules/tasks'
import { useChatStore } from '@/store/chatStore'
import { useChatStreamingStore } from '@/store/chatStreamingStore'
import type { Conversation } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'
import { resolveProviderModelAlias } from '@/utils/providerModels'
import { st } from '@/i18n/service'

type ProviderToolNameMapEntry = ProviderNativeToolNameMapEntry<ConversationToolCatalogManifest['source']>
type ProviderToolDeclaration = ProviderNativeToolDeclarationResult<ConversationToolCatalogManifest['source']>
type ProviderToolUsage = ProviderRuntimeCompletionResult['usage']

export type ConversationProviderToolContext = ProviderToolRuntimeContext<
  ConversationToolCatalogManifest,
  ProviderToolNameMapEntry,
  ProviderToolDeclaration
>

export function createConversationProviderToolTurnRuntime(input: {
  conversationId: string
  assistantMessageId: string
}) {
  const runtime = createAssistantProviderToolTurnRuntime<
    AIProvider,
    ConversationToolCatalogManifest,
    ProviderToolNameMapEntry,
    ProviderToolUsage
  >({
    resolveDeclarationTarget(provider, options) {
      return resolveProviderNativeToolDeclarationTarget(provider.type, {
        preferredEndpoint: options.preferredEndpoint === 'responses' ? 'responses' : 'chat',
        assumeOpenAICompatibleTools: options.assumeOpenAICompatibleTools,
        wireProtocol: provider.wireProtocol,
      })
    },
    resolveLimits(settings) {
      return resolveWorkflowRunLimitsFromSettings(settings as Settings)
    },
    listManifests: () => listConversationToolManifests(),
    filterManifests(manifests, settings) {
      return filterProviderNativeChatToolManifests([...manifests], settings as Settings)
    },
    resolveCatalogRevision(manifests) {
      return `islemind.model.operation.catalog.v1:${stableIdentityHash(manifests)}`
    },
    digestArguments: stableIdentityHash,
    buildDeclarations(declarationInput) {
      return buildProviderNativeToolDeclarations({
        manifests: [...declarationInput.manifests],
        target: declarationInput.target as ProviderToolDeclaration['target'],
        permissionCeiling: declarationInput.permissionCeiling,
        maxTools: declarationInput.maxTools,
      })
    },
    resolveTool(map, providerName) {
      return findProviderToolNameMapEntry([...map], providerName)
    },
    manifestValue(manifest, key) {
      return manifest[key as keyof ProviderToolNameMapEntry] as never
    },
    safeText(value, fallback, limit) {
      return safeProviderNativeToolText(typeof value === 'string' ? value : undefined, fallback, limit)
    },
    formatBlocks(blocks) {
      return formatToolBlocks([...blocks] as ExternalToolObservation['blocks'][number][])
    },
    sanitizeAnswer: sanitizeToolRevisionAnswerText,
    stripCallBlocks: stripMcpCallBlocks,
    isInternalOutput: isInternalChatDiagnosticOutput,
    synthesisFailureMessage: providerToolSynthesisFailureMessage,
    nativeSearchNoSourcesText() {
      return st('chatRunner.trace.nativeSearchNoSources')
    },
    isNativeSearchPlaceholder: isNativeSearchPlaceholderResult,
    buildTraceMetadata(metadataInput) {
      return buildProviderNativeToolTraceMetadata(
        metadataInput as Parameters<typeof buildProviderNativeToolTraceMetadata>[0],
      )
    },
    projectObservationMetadata: projectTaskTraceMetadata,
    recordTrace(trace) {
      upsertProviderToolTrace(input, trace)
    },
    traceId: providerToolTraceId,
    now: Date.now,
    async executeTask(taskInput) {
      return executeExternalTaskBoundTool(
        taskInput as Parameters<typeof executeExternalTaskBoundTool>[0],
      )
    },
    createRagRuntime(runtimeInput) {
      return createProviderToolConversationRagRuntime(
        runtimeInput as unknown as ConversationProviderToolRagRuntimeInput,
      )
    },
    buildRuntimeLogOptions(settings) {
      const current = settings as Settings
      return { enabled: current.runtimeLogEnabled, maxBytes: current.runtimeLogMaxBytes }
    },
    buildRevisionMessages(revisionInput, assistantContent) {
      return buildProviderNativeToolRevisionMessages(
        revisionInput as unknown as Parameters<typeof buildProviderNativeToolRevisionMessages>[0],
        assistantContent,
      )
    },
    buildContextPrompt(contextInput) {
      return buildContextPlannerPrompt(contextInput) ?? ''
    },
    resolveGenerationParameters(parameterInput) {
      const provider = parameterInput.provider as AIProvider
      const conversation = parameterInput.conversation as Conversation
      return resolveConversationGenerationParameterRequest({
        provider,
        conversation,
        settings: parameterInput.settings as Settings,
        model: resolveProviderModelAlias(provider, conversation.model),
        temperatureCap: 0.4,
      })
    },
    synthesize: synthesizeProviderToolAnswer,
  })
  return {
    async admit(admissionInput: Parameters<typeof runtime.admit>[0]): Promise<ConversationProviderToolContext | undefined> {
      return await runtime.admit(admissionInput) as unknown as ConversationProviderToolContext | undefined
    },
    execute: runtime.execute,
  }
}

interface ConversationProviderToolRagRuntimeInput {
  conversation: Conversation
  settings: Settings
  provider: AIProvider
  systemPrompt: string
  context: RetrievedConversationKnowledgeContext
}

function createProviderToolConversationRagRuntime(input: ConversationProviderToolRagRuntimeInput) {
  const knowledgeScope = buildKnowledgeScope(
    input.conversation.knowledgeSources ?? input.conversation.skillSnapshot?.knowledgeSources,
  )
  return createConversationRagRuntime({
    settings: input.settings,
    conversationTitle: input.conversation.title,
    systemPrompt: input.systemPrompt,
    memorySources: input.context.sources.filter((source) => source.type === 'memory'),
    retrieveKnowledge: (query, limit, options) => {
      if (options?.signal?.aborted) return Promise.resolve([])
      return searchAgentKnowledge(
        query,
        limit,
        input.settings,
        input.provider,
        knowledgeScope,
        options?.signal,
      )
    },
    retrieveAgentic: (query, plan, limit, options) => {
      if (options?.signal?.aborted) return Promise.resolve([])
      return searchAgenticKnowledgeWithScope({
        query,
        plan,
        limit,
        knowledgeScope,
        signal: options?.signal,
      })
    },
  })
}

async function searchAgentKnowledge(
  query: string,
  limit: number,
  settings: Settings,
  provider: AIProvider,
  knowledgeScope?: KnowledgeScope,
  signal?: AbortSignal,
) {
  if (!settings.knowledgeEnabled || settings.ragMode === 'off') return []
  return searchKnowledgeWithFallback({
    query,
    limit,
    ragMode: settings.ragMode === 'fts' ? 'fts' : 'hybrid',
    embeddingMode: settings.embeddingMode ?? 'hybrid',
    localEmbeddingModelId: settings.localEmbeddingModelId,
    localEmbeddingModelSource: settings.localEmbeddingModelSource,
    provider,
    knowledgeScope,
    signal,
  })
}

async function synthesizeProviderToolAnswer(request: Record<string, unknown>) {
  let text = ''
  let usage: ProviderToolUsage
  let failure: Error | null = null
  const handle = await conversationProviderGateway.startRuntimeStream(
    request as unknown as Parameters<typeof conversationProviderGateway.startRuntimeStream>[0],
    {
      onChunk(chunk) {
        text += chunk
        useChatStreamingStore.getState().appendContent(
          request.conversationId as string,
          request.assistantMessageId as string,
          chunk,
        )
      },
      onDone(result) {
        text = result.text || text
        usage = result.usage
      },
      onError(error) {
        failure = error
      },
    },
  )
  await handle.done
  if (failure) throw failure
  return { text, usage }
}

function isNativeSearchPlaceholderResult(input: {
  result: ProviderToolObservation
  tool: ProviderToolNameMapEntry
  toolOutput: string
}): boolean {
  const metadata = input.result.diagnostic.metadata ?? {}
  if (input.tool.source !== 'builtin' || input.tool.toolName !== 'search_web') return false
  if (metadata.code === 'native' || metadata.mode === 'native') return true
  return /^(Using provider-native search\.|使用服务商原生搜索。|プロバイダーのネイティブ検索を使用します。)$/i.test(
    input.toolOutput.trim(),
  )
}

function projectTaskTraceMetadata(observation: ProviderToolObservation): Record<string, unknown> {
  const metadata = { ...(observation.metadata ?? {}), ...(observation.diagnostic.metadata ?? {}) }
  return Object.fromEntries(
    ['vnextTaskId', 'vnextTaskStatus', 'vnextTaskPolicy', 'vnextAssistantRunId']
      .flatMap((key) => typeof metadata[key] === 'string' ? [[key, metadata[key]]] : []),
  )
}

function upsertProviderToolTrace(
  input: { conversationId: string; assistantMessageId: string },
  trace: Record<string, unknown>,
) {
  const projected = trace.status === 'running'
    ? trace as unknown as ProcessTrace
    : completeTrace(trace as unknown as ProcessTrace)
  const safeTrace = sanitizeTrace(projected)
  const streamingStore = useChatStreamingStore.getState()
  if (streamingStore.activeStreams.get(`${input.conversationId}:${input.assistantMessageId}`) === true) {
    streamingStore.upsertTrace(input.conversationId, input.assistantMessageId, safeTrace)
    return
  }
  useChatStore.getState().upsertMessageTrace(input.conversationId, input.assistantMessageId, safeTrace)
}

function providerToolTraceId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
