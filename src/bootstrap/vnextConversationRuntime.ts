import {
  asAssistantRunId,
  systemClock,
  type IdGenerator,
} from '@/core'
import {
  buildAssistantContextPlanReceipt,
  createSqliteAssistantRunPersistence,
} from '@/modules/assistant-runtime'
import {
  createConversationRunUseCase,
  createSqliteConversationRepository,
  type ConversationRunRequestPreparation,
  type ConversationRunUseCase,
} from '@/modules/conversations'
import {
  appendProviderContext,
  createContextSnapshotAssembler,
  createConversationContextRetrievalPort,
  createKnowledgeContextRetriever,
  createSqliteContextSnapshotRepository,
  type AssembledContext,
  type KnowledgeContextRetriever,
} from '@/modules/knowledge'
import {
  createSameProviderFallbackResolver,
  type ProviderCapability,
  type ProviderFallbackModelDescriptor,
  type ProviderRuntimeChatSettings,
  type SameProviderFallbackDescriptor,
} from '@/modules/providers'
import { createExpoSqliteDatabaseProvider } from '@/platform/storage'
import type { Conversation, Message } from '@/types/chatContracts'
import type { AIModel, AIProvider } from '@/types/providerContracts'
import { getModelConfig } from '@/types/modelCatalog'
import type { RetrievalSource } from '@/types/contextContracts'
import type { Settings } from '@/types/settingsContracts'
import { createAppContainer } from './createAppContainer'
import { buildChatContextRuntime } from './contextContributionRuntime'
import { planChatContext } from './contextPlanning'
import { retrieveConversationKnowledgeContext } from './knowledgeContextRuntime'
import { createProviderRuntimeAdapter } from './providerRuntime'
import { createConversationModelOperationSession } from './conversationModelOperationRuntime'
import { preserveMessageIdentity } from './plainChatMessageIdentity'
import { buildSystemPrompt } from '@/services/promptEngineering'

const databaseProvider = createExpoSqliteDatabaseProvider()
const runPersistence = createSqliteAssistantRunPersistence(databaseProvider)
const conversations = createSqliteConversationRepository(databaseProvider)
const contextSnapshots = createSqliteContextSnapshotRepository(databaseProvider)
let idSequence = 0

const ids: IdGenerator = {
  next(prefix) {
    idSequence += 1
    return `${prefix}-${Date.now().toString(36)}-${idSequence.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  },
}

export interface VNextConversationRuntimeOptions {
  provider?: AIProvider
  providerSettings?: ProviderRuntimeChatSettings
  providerFallbackDescriptors?: readonly SameProviderFallbackDescriptor[]
  contextRetriever?: KnowledgeContextRetriever
  requestPreparation?: ConversationRunRequestPreparation
  createModelOperationSession?: () => ReturnType<typeof createConversationModelOperationSession>
}

export interface VNextPlainChatRuntimeInput {
  conversation: Conversation
  provider: AIProvider
  settings: Settings
}

export function createVNextConversationRuntime(
  options: VNextConversationRuntimeOptions = {},
): ConversationRunUseCase {
  const container = createAppContainer({
    clock: systemClock,
    ids,
    providerAdapters: options.provider
      ? [createProviderRuntimeAdapter({ provider: options.provider, ...(options.providerSettings ? { settings: options.providerSettings } : {}) })]
      : [],
    runPersistence,
  })
  const contextSnapshotAssembler = createContextSnapshotAssembler({
    clock: systemClock,
    ids,
    repository: contextSnapshots,
    ...(options.contextRetriever ? { retriever: options.contextRetriever } : {}),
  })
  // The generic factory is also used by deferred recovery. Do not let a
  // recovery-only instance accidentally dispatch an unplanned full history.
  const requestPreparation = options.requestPreparation ?? {
    prepare() {
      throw new Error(
        'A bounded Chat request preparation policy is required for new turns. Use createVNextPlainChatRuntime.',
      )
    },
  } satisfies ConversationRunRequestPreparation
  return createConversationRunUseCase({
    clock: systemClock,
    ids,
    conversations,
    assistantRuntime: container.assistantRuntime,
    contextSnapshotAssembler,
    requestPreparation,
    ...(options.providerFallbackDescriptors?.length ? {
      providerGatewayOptions: {
        resolveFallbackRoutes: createSameProviderFallbackResolver(options.providerFallbackDescriptors),
      },
    } : {}),
    ...(options.createModelOperationSession ? {
      createModelOperationSession: options.createModelOperationSession,
    } : {}),
  })
}

/**
 * Bootstrap-only composition for the plain-chat presentation controller. The
 * target feature receives this factory instead of importing legacy adapters.
 */
export function createVNextPlainChatRuntime(
  input: VNextPlainChatRuntimeInput,
): ConversationRunUseCase {
  return createVNextConversationRuntime({
    provider: input.provider,
    providerSettings: input.settings,
    providerFallbackDescriptors: [createProviderFallbackDescriptor(input.provider)],
    contextRetriever: createKnowledgeContextRetriever({
      port: createConversationContextRetrievalPort<Message, Conversation>({
        conversation: input.conversation,
        retrieveContext: (conversation, message, { signal }) => (
          retrieveConversationKnowledgeContext(conversation, message, signal)
        ),
      }),
    }),
    requestPreparation: createPlainChatRequestPreparation({
      provider: input.provider,
      settings: input.settings,
    }),
    createModelOperationSession: () => createConversationModelOperationSession(input),
  })
}

function createPlainChatRequestPreparation(input: {
  provider: AIProvider
  settings: Settings
}): ConversationRunRequestPreparation {
  return {
    async prepare(preparation) {
      throwIfAborted(preparation.cancellationSignal)

      const modelConfig = getModelConfig(
        preparation.request.model,
        input.provider.type,
        input.provider.modelConfigs,
      )
      const retrievedSources = toRetrievalSources(preparation.assembledContext)
      const contextRuntime = buildChatContextRuntime({
        retrievedContext: {
          sources: retrievedSources,
          prompt: preparation.assembledContext?.providerContext ?? '',
        },
      })
      const retrievalSources = contextRuntime.retrievalSources
      const systemPrompt = buildSystemPrompt({
        baseSystemPrompt: preparation.conversation.systemPrompt,
        language: input.settings.language,
        modelConfig,
        provider: input.provider,
        hasMemory: contextRuntime.counts.memory > 0,
        hasKnowledge: contextRuntime.counts.knowledge > 0,
        hasWeb: false,
        retrievalSources,
      })
      const contextSources = contextRuntime.contextSources
      const planningMessages = preparation.request.messages
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .map((message) => ({
          role: message.role as 'user' | 'assistant',
          content: message.text,
        }))
      const latestUserMessage = [...planningMessages]
        .reverse()
        .find((message) => message.role === 'user')

      // The canonical ConversationRun path does not yet carry the native
      // remote-compact handoff fields. Force the planner to emit the exact
      // local packed request rather than persisting a plan that would require
      // a second provider-specific compaction decision downstream.
      const plan = planChatContext({
        messages: planningMessages,
        ...(latestUserMessage ? { draft: { text: latestUserMessage.content } } : {}),
        contextSources,
        modelContextWindow: modelConfig.contextWindow,
        maxOutputTokens: preparation.request.maxTokens ?? modelConfig.defaultMaxTokens,
        modelManifest: modelConfig,
        systemPrompt,
        reasoningEffort: preparation.request.reasoningEffort,
        provider: input.provider,
        providerType: input.provider.type,
        model: preparation.request.model,
        settings: {
          ...input.settings,
          remoteCompactMode: 'off',
        },
        retrievalSources,
        memorySourceCount: contextRuntime.counts.memory,
      })
      throwIfAborted(preparation.cancellationSignal)

      const plannedMessages = preserveMessageIdentity(
        plan.messages,
        preparation.request.messages,
      )
      const plannedSystemPrompt = appendProviderContext(
        systemPrompt,
        plan.contextPrompt,
      )
      return {
        request: {
          ...preparation.request,
          messages: plannedMessages,
          ...(plannedSystemPrompt ? { systemPrompt: plannedSystemPrompt } : {}),
        },
        contextReceipt: buildAssistantContextPlanReceipt({
          providerId: preparation.request.providerId,
          model: preparation.request.model,
          plan,
          activePrompt: plan.packed,
        }),
      }
    },
  }
}

function toRetrievalSources(
  assembled: AssembledContext | undefined,
): RetrievalSource[] {
  if (!assembled) return []
  const citations = assembled.citations
    .filter((citation) => citation.type === 'memory' || citation.type === 'knowledge' || citation.type === 'web')
    .map((citation) => ({
      ...citation,
      content: citation.excerpt ?? citation.title,
    }))
  if (citations.length) return citations
  return assembled.sources.flatMap<RetrievalSource>((source) => {
    if (source.kind !== 'memory' && source.kind !== 'knowledge' && source.kind !== 'web') return []
    return [{
      id: source.id,
      type: source.kind,
      title: source.title ?? source.id,
      content: source.title ?? source.id,
      ...(source.sourceUri ? { sourceUri: source.sourceUri } : {}),
      ...(source.score === undefined ? {} : { score: source.score }),
    }]
  })
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  const error = new Error('Conversation request preparation was cancelled.')
  error.name = 'AbortError'
  throw error
}

export async function resumeVNextConversationModelOperation(input: {
  conversation: Conversation
  provider: AIProvider
  settings: Settings
  runId: string
  approved: boolean
  projection: Parameters<ConversationRunUseCase['resumeModelOperation']>[0]['projection']
}): Promise<boolean> {
  const runtime = createVNextPlainChatRuntime(input)
  const result = await runtime.resumeModelOperation({
    runId: asAssistantRunId(input.runId),
    approved: input.approved,
    projection: input.projection,
  })
  return result.ok && result.value.status !== 'awaiting-confirmation'
}

function createProviderFallbackDescriptor(provider: AIProvider): SameProviderFallbackDescriptor {
  return {
    providerId: provider.id,
    enabled: provider.enabled,
    models: fallbackModels(provider),
    credentials: provider.credentialGroups?.length
      ? provider.credentialGroups.map((group) => ({
          enabled: group.enabled,
          hasCredential: Boolean(group.apiKey?.trim() || provider.apiKey?.trim()),
          ...(group.availableModels?.length ? { availableModels: credentialModels(provider, group.availableModels) } : {}),
        }))
      : [{ enabled: true, hasCredential: Boolean(provider.apiKey?.trim()) }],
  }
}

function fallbackModels(provider: AIProvider): ProviderFallbackModelDescriptor[] {
  const ids = Array.from(new Set([
    ...provider.models,
    ...(provider.manualModels ?? []),
    ...(provider.modelConfigs ?? []).map((model) => model.id),
    ...(provider.modelAvailability ?? []).map((entry) => entry.modelId),
    ...(provider.modelAliases ?? []).map((entry) => entry.model),
  ].map((model) => model.trim()).filter(Boolean)))
  return ids.map((id) => {
    const model = getModelConfig(id, provider.type, provider.modelConfigs)
    return {
      id,
      ...(model.deprecated === true ? { deprecated: true } : {}),
      capabilities: configuredCapabilities(provider, model),
    }
  })
}

function configuredCapabilities(
  provider: AIProvider,
  model: AIModel,
): ProviderCapability[] {
  const capabilities: ProviderCapability[] = ['chat']
  if (provider.capabilities?.vision === true && model.supportsVision !== false) capabilities.push('vision')
  if (provider.capabilities?.files === true && model.supportsFiles !== false) capabilities.push('files')
  if (provider.capabilities?.audioInput === true) capabilities.push('audio')
  if (provider.capabilities?.nativeTools === true && model.supportsTools !== false) capabilities.push('tools')
  return capabilities
}

function credentialModels(provider: AIProvider, availableModels: readonly string[]): string[] {
  const available = new Set(availableModels)
  for (const alias of provider.modelAliases ?? []) {
    if (available.has(alias.model)) available.add(alias.alias)
  }
  return [...available]
}
