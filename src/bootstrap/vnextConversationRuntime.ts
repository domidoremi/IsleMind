import { asAssistantRunId, systemClock, type IdGenerator } from '@/core'
import {
  createSqliteAssistantRunPersistence,
} from '@/modules/assistant-runtime'
import {
  createConversationRunUseCase,
  createSqliteConversationRepository,
  type ConversationRunUseCase,
} from '@/modules/conversations'
import {
  createContextSnapshotAssembler,
  createConversationContextRetrievalPort,
  createKnowledgeContextRetriever,
  createSqliteContextSnapshotRepository,
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
import type { Settings } from '@/types/settingsContracts'
import { createAppContainer } from './createAppContainer'
import { retrieveConversationKnowledgeContext } from './knowledgeContextRuntime'
import { createProviderRuntimeAdapter } from './providerRuntime'
import { createConversationModelOperationSession } from './conversationModelOperationRuntime'

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
  return createConversationRunUseCase({
    clock: systemClock,
    ids,
    conversations,
    assistantRuntime: container.assistantRuntime,
    contextSnapshotAssembler,
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
    createModelOperationSession: () => createConversationModelOperationSession(input),
  })
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
