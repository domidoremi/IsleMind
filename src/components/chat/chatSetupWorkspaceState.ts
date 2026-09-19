import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { TFunction } from 'i18next'

import type { useIsleDialog } from '@/components/ui/isle'
import type { ConversationChatWorkflowRuntimeRequestedOutput } from '@/modules/tasks'
import { sendConversationMessage as sendMessage } from '@/presentation/features/conversations/conversationMessageCommand'
import { resolveProviderDisplayName } from '@/presentation/features/settings/providerPresentation'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import type { Attachment, Conversation } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import { resolveChatMultimodalPolicy, type ChatMultimodalPolicy } from '@/presentation/features/chat/chatMultimodalPolicy'
import { getProviderModelDisplayCandidates, hasProviderModelAccessRules, resolveProviderModelAliasAccess } from '@/bootstrap/providerModelAccess'
import { resolveEffectiveProviderCapabilityManifest as resolveProviderCapabilityManifest } from '@/bootstrap/providerModelExecutionProfile'
import { getConversationReasoningEffortOptions } from '@/bootstrap/providerConversationGeneration'

import type { ComposerPanel } from './FloatingComposer'
import { resolveChatModelDisplayName } from './chatIdentityPresentation'
import {
  DEFAULT_SETUP_REASONING_EFFORT,
  MODEL_VALIDATION_LOOKUP_LIMIT,
} from './chatWorkspaceConstants'
import { resolveBlockedComposerDraftRecovery } from './composerDraftState'
import {
  MODEL_QUICK_OPTION_PROVIDER_LIMIT as CHAT_MODEL_QUICK_OPTION_PROVIDER_LIMIT,
  buildExplicitGenerationParameterOverridePatch,
  createSetupConversationShell,
  getPolicyAllowedProviderModels,
  getPolicyPreferredProviderModel,
  pickModelAccessSettings,
  pickReadyProviderForNewConversation,
  providerHasPolicyAllowedModel,
  type ModelAccessSettings,
} from './chatModelSelection'

type ChatSetupDialog = ReturnType<typeof useIsleDialog>
type ChatSetupSettings = ReturnType<typeof useSettingsStore.getState>['settings']
type ApplyQuickStartDraft = (draft: string, attachments?: Attachment[], restoreIfEmpty?: boolean) => void

interface ChatSetupWorkspaceStateOptions {
  active: boolean
  applyQuickStartDraft: ApplyQuickStartDraft
  composerOutputMode: ConversationChatWorkflowRuntimeRequestedOutput
  conversation: Conversation | null
  createConversation: (providerId: string, model: string) => string
  dialog: ChatSetupDialog
  markChromeActive: () => void
  modelAccessSettings: ModelAccessSettings
  providers: AIProvider[]
  setComposerPanel: Dispatch<SetStateAction<ComposerPanel>>
  setShowOptions: Dispatch<SetStateAction<boolean>>
  settings: ChatSetupSettings
  t: TFunction
  updateConversation: (id: string, updates: Partial<Conversation>) => void
}

export interface ChatSetupWorkspaceState {
  emptyHeaderSubtitle?: string
  emptyHeaderTitle: string
  hasAvailableModel: boolean
  hasEnabledProvider: boolean
  homeProvider?: AIProvider
  modelAccessHasRules: boolean
  openSetupAiConfiguration: () => void
  quickModelProviders: AIProvider[]
  setupConversation: Conversation
  setupMultimodalPolicy: ChatMultimodalPolicy
  setupProviderName?: string
  setupReasoningEffort: Conversation['reasoningEffort']
  setupSystemPrompt: string
  setSetupReasoningEffort: Dispatch<SetStateAction<Conversation['reasoningEffort']>>
  setSetupSystemPrompt: Dispatch<SetStateAction<string>>
  submitSetup: (content: string, attachments: Attachment[]) => Promise<void>
  supportsSetupReasoningQuick: boolean
  switchSetupModel: (nextModel: string) => void
  switchSetupProviderModel: (nextProvider: AIProvider, nextModel: string) => void
}

export function useChatSetupWorkspaceState({
  active,
  applyQuickStartDraft,
  composerOutputMode,
  conversation,
  createConversation,
  dialog,
  markChromeActive,
  modelAccessSettings,
  providers,
  setComposerPanel,
  setShowOptions,
  settings,
  t,
  updateConversation,
}: ChatSetupWorkspaceStateOptions): ChatSetupWorkspaceState {
  const [setupReasoningEffort, setSetupReasoningEffort] = useState<Conversation['reasoningEffort']>(DEFAULT_SETUP_REASONING_EFFORT)
  const [setupParameterOverrides] = useState<Partial<Pick<Conversation, 'temperature' | 'topP' | 'topK' | 'maxTokens'>>>({})
  const [setupSystemPrompt, setSetupSystemPrompt] = useState('')
  const [setupSelectedProviderId, setSetupSelectedProviderId] = useState<string | null>(null)
  const [setupSelectedModel, setSetupSelectedModel] = useState<string | null>(null)
  const [setupSelectionExplicit, setSetupSelectionExplicit] = useState(false)
  const enabledProviders = useMemo(() => providers.filter((item) => item.id !== 'local-setup' && item.enabled), [providers])
  const hasEnabledProvider = enabledProviders.length > 0
  const modelAccessHasRules = useMemo(
    () => hasProviderModelAccessRules(modelAccessSettings),
    [modelAccessSettings]
  )
  // Selection is not dispatch: a cached model survives a failed/offline health check.
  const readyProviders = useMemo(() => getProviderModelDisplayCandidates({ providers: enabledProviders, modelLimit: 1, includePreferredModel: false }).map((item) => item.provider), [enabledProviders])
  const quickModelProviders = useMemo(
    () => modelAccessHasRules ? readyProviders.filter((item) => providerHasPolicyAllowedModel(item, modelAccessSettings)) : readyProviders,
    [modelAccessHasRules, modelAccessSettings, readyProviders]
  )
  const hasAvailableModel = quickModelProviders.length > 0
  const rememberedProvider = quickModelProviders.find((item) => item.id === settings.lastPreferredModel?.providerId)
  const rememberedModel = rememberedProvider && settings.lastPreferredModel
    && resolveProviderModelAliasAccess({ provider: rememberedProvider, model: settings.lastPreferredModel.model, settings: modelAccessSettings }).allowed
    ? settings.lastPreferredModel.model : undefined
  const defaultHomeProvider = useMemo(() => pickReadyProviderForNewConversation(providers, settings.defaultProvider, modelAccessSettings, modelAccessHasRules), [modelAccessHasRules, modelAccessSettings, providers, settings.defaultProvider])
  const setupSelectedProvider = setupSelectedProviderId ? quickModelProviders.find((item) => item.id === setupSelectedProviderId) : undefined
  const homeProvider = (setupSelectionExplicit ? setupSelectedProvider : undefined) ?? (rememberedModel ? rememberedProvider : undefined) ?? defaultHomeProvider ?? quickModelProviders[0]
  const homeProviderModels = useMemo(() => homeProvider ? getPolicyAllowedProviderModels(homeProvider, modelAccessSettings, { limit: CHAT_MODEL_QUICK_OPTION_PROVIDER_LIMIT }) : [], [homeProvider, modelAccessSettings])
  const preferredSetupModel = homeProvider?.id === rememberedProvider?.id && rememberedModel
    ? rememberedModel : homeProvider ? getPolicyPreferredProviderModel(homeProvider, modelAccessSettings) ?? homeProviderModels[0] : undefined
  const setupModel = setupSelectionExplicit && homeProvider && setupSelectedModel
    && resolveProviderModelAliasAccess({ provider: homeProvider, model: setupSelectedModel, settings: modelAccessSettings }).allowed
    ? setupSelectedModel!
    : preferredSetupModel ?? 'setup-model'
  const setupTemperature = settings.defaultTemperature
  const setupMaxTokens = settings.defaultMaxTokens
  const setupConversation = useMemo<Conversation>(() => ({ ...createSetupConversationShell(homeProvider ?? null, setupModel, setupReasoningEffort, setupSystemPrompt, setupTemperature, setupMaxTokens, setupParameterOverrides), providerModelMode: setupSelectionExplicit ? 'manual' : 'inherited' }), [homeProvider, setupModel, setupReasoningEffort, setupSystemPrompt, setupTemperature, setupMaxTokens, setupParameterOverrides, setupSelectionExplicit])
  const supportsSetupReasoningQuick = getConversationReasoningEffortOptions(homeProvider, setupModel).length > 0
  const setupMultimodalPolicy = useMemo(
    () => resolveChatMultimodalPolicy({
      provider: homeProvider,
      model: setupModel,
      resolveProviderCapabilityManifest,
    }),
    [homeProvider, setupModel]
  )
  const emptyHeaderTitle = !hasEnabledProvider ? t('chat.noProviderConnected') : hasAvailableModel ? homeProvider?.name ?? t('settings.providerManagement') : t('chat.noAvailableModels')
  const emptyHeaderSubtitle = homeProvider ? resolveChatModelDisplayName(homeProvider, setupModel, settings.modelDisplayAliases) : undefined
  const setupProviderName = homeProvider?.name ?? enabledProviders[0]?.name

  useEffect(() => {
    if (conversation) return
    setSetupReasoningEffort((current) => current === DEFAULT_SETUP_REASONING_EFFORT ? current : DEFAULT_SETUP_REASONING_EFFORT)
  }, [conversation])

  useEffect(() => {
    if (!active) return
    if (!homeProvider) {
      setSetupSelectedProviderId(null)
      setSetupSelectedModel(null)
      return
    }
    if (!setupSelectedProviderId || !quickModelProviders.some((item) => item.id === setupSelectedProviderId)) {
      setSetupSelectedProviderId(homeProvider.id)
    }
    if (setupSelectedModel && homeProviderModels.includes(setupSelectedModel)) return
    setSetupSelectedModel(getPolicyPreferredProviderModel(homeProvider, modelAccessSettings) ?? homeProviderModels[0] ?? null)
  }, [active, homeProvider?.id, homeProviderModels.join('|'), modelAccessSettings, quickModelProviders, setupSelectedModel, setupSelectedProviderId])

  const showNoAvailableModelsFeedback = () => dialog.toast({
    title: t('chat.noAvailableModels'),
    message: t('chat.syncModelsBeforeChat'),
    tone: 'amber',
    actionLabel: t('chat.configureProviders'),
    onAction: openSetupAiConfiguration,
    dedupeKey: 'chat-setup-model-unavailable',
  })

  const showNoProviderFeedback = () => dialog.toast({
    title: t('chat.noProviderConnected'),
    message: t('chat.configureProviderBeforeChat'),
    tone: 'amber',
    actionLabel: t('chat.configureProviders'),
    onAction: openSetupAiConfiguration,
    dedupeKey: 'chat-setup-provider-required',
  })

  async function submitSetup(content: string, attachments: Attachment[]) {
    const blockedDraft = resolveBlockedComposerDraftRecovery(content, attachments)
    const restoreBlockedDraft = () => {
      if (!blockedDraft) return
      applyQuickStartDraft(blockedDraft.content, blockedDraft.attachments, blockedDraft.restoreIfEmpty)
    }
    const currentSettings = useSettingsStore.getState().settings
    const currentAccessSettings = pickModelAccessSettings(currentSettings)
    const readyProvider = homeProvider ?? pickReadyProviderForNewConversation(
      useSettingsStore.getState().providers,
      currentSettings.defaultProvider,
      currentAccessSettings,
      hasProviderModelAccessRules(currentAccessSettings),
    )
    if (!readyProvider) {
      restoreBlockedDraft()
      if (hasEnabledProvider && !hasAvailableModel) {
        showNoAvailableModelsFeedback()
        return
      }
      showNoProviderFeedback()
      return
    }
    const providerModels = getPolicyAllowedProviderModels(readyProvider, currentAccessSettings, { limit: MODEL_VALIDATION_LOOKUP_LIMIT })
    const model = providerModels.includes(setupModel) ? setupModel : getPolicyPreferredProviderModel(readyProvider, currentAccessSettings)
    if (!model) {
      restoreBlockedDraft()
      showNoAvailableModelsFeedback()
      return
    }
    const nextSetupConversation = { ...createSetupConversationShell(readyProvider, model, setupReasoningEffort, setupSystemPrompt, setupTemperature, setupMaxTokens, setupParameterOverrides), providerModelMode: setupSelectionExplicit ? 'manual' as const : 'inherited' as const }
    const id = createConversation(readyProvider.id, model)
    updateConversation(id, {
      providerModelMode: nextSetupConversation.providerModelMode,
      systemPrompt: setupSystemPrompt,
      reasoningEffort: nextSetupConversation.reasoningEffort,
      temperature: nextSetupConversation.temperature,
      topP: nextSetupConversation.topP,
      topK: nextSetupConversation.topK,
      maxTokens: nextSetupConversation.maxTokens,
      generationParameterOverrides: buildExplicitGenerationParameterOverridePatch(nextSetupConversation.generationParameterOverrides),
    })
    const nextConversation = useChatStore.getState().conversations.find((item) => item.id === id)
    if (!nextConversation) {
      restoreBlockedDraft()
      useChatStore.getState().select(null)
      return
    }
    await sendMessage({ conversation: { ...nextConversation, ...nextSetupConversation, id: nextConversation.id, title: nextConversation.title, messages: nextConversation.messages, createdAt: nextConversation.createdAt, updatedAt: nextConversation.updatedAt }, content, attachments, requestedOutput: composerOutputMode })
    const currentState = useChatStore.getState()
    if (currentState.currentId === id && currentState.draftConversationIds.has(id)) {
      restoreBlockedDraft()
      currentState.select(null)
    }
    setSetupSelectionExplicit(false)
  }

  function openSetupAiConfiguration() {
    markChromeActive()
    setComposerPanel(null)
    setShowOptions(true)
  }

  function switchSetupModel(nextModel: string) {
    if (!homeProvider) return
    if (!resolveProviderModelAliasAccess({ provider: homeProvider, model: nextModel, settings: modelAccessSettings }).allowed) {
      return
    }
    setSetupSelectedProviderId(homeProvider.id)
    setSetupSelectedModel(nextModel)
    setSetupSelectionExplicit(true)
    rememberExplicitModel(homeProvider.id, nextModel)
    dialog.toast({ title: t('chat.modelSwitched'), message: `${resolveProviderDisplayName(homeProvider, t('providerSettings.customProvider'))} · ${resolveChatModelDisplayName(homeProvider, nextModel, settings.modelDisplayAliases)}`, tone: 'mint' })
  }

  function switchSetupProviderModel(nextProvider: AIProvider, nextModel: string) {
    if (!resolveProviderModelAliasAccess({ provider: nextProvider, model: nextModel, settings: modelAccessSettings }).allowed) {
      return
    }
    setSetupSelectedProviderId(nextProvider.id)
    setSetupSelectedModel(nextModel)
    setSetupSelectionExplicit(true)
    rememberExplicitModel(nextProvider.id, nextModel)
    dialog.toast({ title: t('chat.modelSwitched'), message: `${resolveProviderDisplayName(nextProvider, t('providerSettings.customProvider'))} · ${resolveChatModelDisplayName(nextProvider, nextModel, settings.modelDisplayAliases)}`, tone: 'mint' })
  }

  function rememberExplicitModel(providerId: string, model: string) {
    void useSettingsStore.getState().rememberPreferredModel(providerId, model).catch(() => {
      dialog.toast({ title: t('chat.preferredModelSaveFailed'), tone: 'amber' })
    })
  }

  return {
    emptyHeaderSubtitle,
    emptyHeaderTitle,
    hasAvailableModel,
    hasEnabledProvider,
    homeProvider,
    modelAccessHasRules,
    openSetupAiConfiguration,
    quickModelProviders,
    setupConversation,
    setupMultimodalPolicy,
    setupProviderName,
    setupReasoningEffort: setupConversation.reasoningEffort,
    setupSystemPrompt,
    setSetupReasoningEffort,
    setSetupSystemPrompt,
    submitSetup,
    supportsSetupReasoningQuick,
    switchSetupModel,
    switchSetupProviderModel,
  }
}
