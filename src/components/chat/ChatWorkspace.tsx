import type { PropsWithChildren, ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import {
  BackHandler,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type StyleProp,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type LayoutChangeEvent,
  type ViewStyle,
} from 'react-native'
import { FlashList, type FlashListRef } from '@shopify/flash-list'
import * as Clipboard from 'expo-clipboard'
import * as Linking from 'expo-linking'
import { router } from 'expo-router'
import { AlertTriangle, Bot, ChevronRight, FileText, GitBranchPlus, ListEnd, SlidersHorizontal, Split, Square, X } from 'lucide-react-native'
import { AnimatePresence, MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import { AnimatedNavigationIcon, type NavigationGlyph } from '@/components/navigation/AnimatedNavigationIcon'
import { AnimatedNavigationTrigger, useNavigationTrigger } from '@/components/navigation/AnimatedNavigationTrigger'
import { IsleScreen, type IsleBackgroundState } from '@/components/ui/isle'
import { IsleOverlayPressable, IslePressable } from '@/components/ui/isle'
import { IsleField, IsleHeader, IsleIconButton, IsleSheet } from '@/components/ui/isle'
import { useIsleDialog } from '@/components/ui/isle'
import { Composer } from '@/components/chat/Composer'
import type { ComposerCommand } from '@/components/chat/Composer'
import { ChatOptionsPanel } from '@/components/chat/ChatOptionsPanel'
import { MessageBubble } from '@/components/chat/MessageBubble'
import { IsleEmptyState } from '@/components/ui/isle'
import { copyMessageFinalText, recoverStaleStreamingMessages, regenerateLastAssistant, retryMessage, sendMessage, stopMessage } from '@/services/chatRunner'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { testProviderModelDetailed } from '@/services/ai/base'
import { getConversationMetrics, type ConversationMetrics } from '@/services/conversationMetrics'
import { getModelConfig, getModelName, getProviderConfigIssue } from '@/types'
import { speakText } from '@/services/speech'
import type { AIProvider, Attachment, ChatErrorCode, Conversation, Message, ProviderOperationCode } from '@/types'
import type { CommandReference, KnowledgeDocument, MemoryItem, SkillDefinition } from '@/types'
import { collectMessageTraces, getActiveTraceTitle } from './tracePresentation'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useMainPagerGestureLock } from '@/components/main/MainPagerGestureLock'
import { applySkillStack, createBaseSkill, extractSkillVariables, listSkills, upsertSkill } from '@/services/skills'
import { listKnowledgeDocuments, listMemories } from '@/services/contextStore'
import { getProviderAvailableModels, getProviderDisplayModel, hasRemoteProviderModelEvidence, inferModelFamily, isProviderConversationReady, MODEL_QUICK_GROUPS, resolveProviderModelAlias, type ModelQuickGroup } from '@/utils/providerModels'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'
import { getReasoningEffortOptions, providerSupportsReasoning } from '@/utils/modelReasoning'
import { getOnboardingConversationDefaults } from '@/utils/onboardingProfile'
import { summarizeWorkArtifact } from '@/utils/workArtifact'
import { getPolicyAllowedProviderModels as getAccessAllowedProviderModels, getPolicyPreferredProviderModel as getAccessPreferredProviderModel, providerHasPolicyAllowedModel as accessProviderHasPolicyAllowedModel, resolveProviderModelAliasAccess } from '@/services/ai/policy/providerModelAccess'

type StreamingInputIntent = 'guide' | 'queue' | 'interrupt'
type ComposerPanel = 'model' | 'reasoning' | 'prompt' | 'more' | null
type ChatOptionsPlacement = 'popover' | 'sheet'

interface ModelQuickOption {
  id: string
  provider: AIProvider
  model: string
  family: ModelQuickGroup
}

const COMPOSER_COLLAPSED_MIN_HEIGHT = 88
const COMPOSER_EXPANDED_MIN_HEIGHT = 132
const AUTO_SCROLL_DELAY_MS = 96
const USER_SCROLL_PAUSE_THRESHOLD = 72
const FLOATING_CHROME_TOP_PADDING = 6
const FLOATING_CHROME_BOTTOM_PADDING = 8
const COLLAPSED_CHROME_TOP_OFFSET = 8
const COLLAPSED_CHROME_HEIGHT = 44
const EMPTY_CONVERSATION_DEFAULT_TOP_PADDING = 36
const EMPTY_CONVERSATION_CHROME_GAP = 16

interface PendingStreamingMessage {
  intent: Exclude<StreamingInputIntent, 'interrupt'>
  content: string
  attachments: Attachment[]
}

interface ChatWorkspaceProps {
  conversation: Conversation | null
  showBack?: boolean
  embedded?: boolean
  initialDraft?: string
  initialDraftKey?: string | number
  settingsTransitionActive?: boolean
  onHistory?: () => void
  onSettings?: () => void
}

export function ChatWorkspace({ conversation, showBack = false, embedded = false, initialDraft, initialDraftKey, settingsTransitionActive = false, onHistory, onSettings }: ChatWorkspaceProps) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const insets = useSafeAreaInsets()
  const { height: windowHeight, width: windowWidth } = useWindowDimensions()
  const motion = useMotionPreference()
  const updateConversation = useChatStore((state) => state.updateConversation)
  const switchConversationModel = useChatStore((state) => state.switchConversationModel)
  const removeMessage = useChatStore((state) => state.removeMessage)
  const createConversation = useChatStore((state) => state.create)
  const providers = useSettingsStore((state) => state.providers)
  const settings = useSettingsStore((state) => state.settings)
  const hydrateProviderKey = useSettingsStore((state) => state.hydrateProviderKey)
  const updateProvider = useSettingsStore((state) => state.updateProvider)
  const pagerGestureLock = useMainPagerGestureLock()
  const setPagerGestureLocked = pagerGestureLock?.setLocked
  const listRef = useRef<FlashListRef<Message>>(null)
  const [showOptions, setShowOptions] = useState(false)
  const [chromeCollapsed, setChromeCollapsed] = useState(false)
  const [providerHealth, setProviderHealth] = useState<ConversationHealth | null>(null)
  const [testingHeader, setTestingHeader] = useState(false)
  const [pendingStreamingMessage, setPendingStreamingMessage] = useState<PendingStreamingMessage | null>(null)
  const [intentDraft, setIntentDraft] = useState<{ content: string; attachments: Attachment[] } | null>(null)
  const [skills, setSkills] = useState<SkillDefinition[]>([])
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeDocument[]>([])
  const [memoryItems, setMemoryItems] = useState<MemoryItem[]>([])
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const [composerFocused, setComposerFocused] = useState(false)
  const [composerPanel, setComposerPanel] = useState<ComposerPanel>(null)
  const [quickToolsCollapsed, setQuickToolsCollapsed] = useState(true)
  const [quickStartDraft, setQuickStartDraft] = useState<{ content: string; key: string } | null>(null)
  const quickStartSequence = useRef(0)
  const initialSetupDefaults = useMemo(() => getOnboardingConversationDefaults(settings.onboardingCompanionMode), [settings.onboardingCompanionMode])
  const [setupReasoningEffort, setSetupReasoningEffort] = useState<NonNullable<Conversation['reasoningEffort']>>(initialSetupDefaults.reasoningEffort)
  const [setupSystemPrompt, setSetupSystemPrompt] = useState(initialSetupDefaults.systemPrompt)
  const [setupSelectedProviderId, setSetupSelectedProviderId] = useState<string | null>(null)
  const [setupSelectedModel, setSetupSelectedModel] = useState<string | null>(null)
  const [composerHeight, setComposerHeight] = useState(COMPOSER_COLLAPSED_MIN_HEIGHT)
  const lastScrollOffset = useRef(0)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastAutoScrollAt = useRef(0)
  const autoStickToBottom = useRef(true)
  const enabledProviders = useMemo(() => providers.filter((item) => item.id !== 'local-setup' && item.enabled), [providers])
  const policyEnabledProviders = useMemo(() => enabledProviders.filter((provider) => providerHasPolicyAllowedModel(provider, settings)), [enabledProviders, settings])
  const hasEnabledProvider = enabledProviders.length > 0
  const readyProviders = useMemo(() => policyEnabledProviders.filter((item) => isProviderConversationReady(item)), [policyEnabledProviders])
  const quickModelProviders = useMemo(() => policyEnabledProviders.filter((item) => getPolicyAllowedProviderModels(item, settings).length > 0), [policyEnabledProviders, settings])
  const hasAvailableModel = quickModelProviders.length > 0
  const defaultHomeProvider = pickReadyProviderForNewConversation(providers, settings.defaultProvider, settings) ?? quickModelProviders[0] ?? null
  const setupSelectedProvider = setupSelectedProviderId ? quickModelProviders.find((item) => item.id === setupSelectedProviderId) : undefined
  const homeProvider = setupSelectedProvider ?? defaultHomeProvider
  const homeProviderModels = homeProvider ? getPolicyAllowedProviderModels(homeProvider, settings) : []
  const setupModel = homeProvider && homeProviderModels.includes(setupSelectedModel ?? '')
    ? setupSelectedModel!
    : homeProvider ? getPolicyPreferredProviderModel(homeProvider, settings) ?? homeProviderModels[0] ?? 'setup-model' : 'setup-model'
  const runtimeTarget = resolveRuntimeTarget(conversation, providers, settings.defaultProvider, settings)
  const runtimeConversation = runtimeTarget?.conversation ?? conversation
  const provider = runtimeTarget?.provider
  const setupTemperature = settings.defaultTemperature ?? initialSetupDefaults.temperature
  const setupConversation = useMemo<Conversation>(() => createSetupConversationShell(homeProvider, setupModel, setupReasoningEffort, setupSystemPrompt, setupTemperature), [homeProvider, setupModel, setupReasoningEffort, setupSystemPrompt, setupTemperature])
  const reasoningEffort = runtimeConversation?.reasoningEffort ?? setupReasoningEffort
  const supportsReasoningQuick = !!provider && providerSupportsReasoning(provider, runtimeConversation?.model)
  const supportsSetupReasoningQuick = !!homeProvider && providerSupportsReasoning(homeProvider, setupModel)
  const emptyHeaderTitle = !hasEnabledProvider ? t('chat.noProviderConnected') : hasAvailableModel ? homeProvider?.name ?? t('settings.providerManagement') : t('chat.noAvailableModels')
  const homeProviderModel = homeProvider ? getPolicyPreferredProviderModel(homeProvider, settings) : undefined
  const emptyHeaderSubtitle = homeProvider && homeProviderModel ? getProviderDisplayModel(homeProvider, homeProviderModel) : undefined
  const providerHealthKey = useMemo(() => provider ? [
    provider.id,
    provider.enabled ? 'on' : 'off',
    getPolicyAllowedProviderModels(provider, settings).join(','),
    provider.baseUrl ?? '',
    provider.credentialMode ?? '',
    provider.tokenPlanRegion ?? '',
    provider.wireProtocol ?? '',
    provider.lastTestStatus ?? '',
    provider.lastTestCode ?? '',
    provider.lastTestModel ?? '',
    provider.lastTestMessage ?? '',
  ].join('|') : runtimeConversation?.providerId ?? 'none', [runtimeConversation?.providerId, provider, settings])
  const switchableProviders = useMemo(
    () => providers.filter((item) => item.id !== 'local-setup' && providerHasPolicyAllowedModel(item, settings)),
    [providers, settings]
  )
  const metrics = useMemo(() => getConversationMetrics(runtimeConversation), [runtimeConversation])
  const streamingMessage = runtimeConversation?.messages.find((message) => message.status === 'streaming')
  const isStreaming = !!streamingMessage
  const lastMessage = runtimeConversation?.messages.at(-1)
  const regenerableAssistantId = lastMessage?.role === 'assistant' ? lastMessage.id : undefined
  const messageSignature = runtimeConversation?.messages.map((message) => `${message.id}:${message.content.length}:${message.status}`).join('|')
  const activityLabel = streamingMessage ? getMessageActivityLabel(streamingMessage, t) : ''
  const compactViewport = windowHeight < 620 || windowWidth < 360
  const optionsPanelPlacement: ChatOptionsPlacement = windowWidth < 600 || windowHeight < 720 ? 'sheet' : 'popover'
  const optionsPanelHeight = Math.max(compactViewport ? 360 : 430, Math.min(windowHeight * 0.7, compactViewport ? 460 : 620))
  const effectiveInitialDraft = quickStartDraft?.content ?? initialDraft
  const effectiveInitialDraftKey = quickStartDraft?.key ?? initialDraftKey
  const composerMinimumHeight = quickToolsCollapsed ? COMPOSER_COLLAPSED_MIN_HEIGHT : COMPOSER_EXPANDED_MIN_HEIGHT
  const composerBottomInset = Math.max(composerMinimumHeight, composerHeight + Math.max(insets.bottom, 10) + 10)
  const keyboardLift = keyboardHeight
  const keyboardVisible = keyboardHeight > 0 || composerFocused
  const backgroundState: IsleBackgroundState = providerHealth?.code
    ? 'error'
    : showOptions || composerPanel || intentDraft
      ? 'modal'
      : keyboardVisible
        ? 'input'
        : isStreaming
          ? 'active'
          : 'idle'
  const goHistory = onHistory ?? (() => router.push('/conversations'))
  const goSettings = onSettings ?? (() => router.push('/settings'))
  const goProviders = () => pushSettingsRoute('/settings/providers')
  const goKnowledge = () => pushSettingsRoute('/settings/knowledge', { focus: 'import' })
  const pendingNotice = pendingStreamingMessage
    ? pendingStreamingMessage.intent === 'guide'
      ? `${t('chat.pendingGuide')} · ${previewPendingText(pendingStreamingMessage.content, pendingStreamingMessage.attachments, t)}`
      : `${t('chat.pendingQueue')} · ${previewPendingText(pendingStreamingMessage.content, pendingStreamingMessage.attachments, t)}`
    : undefined
  const composerCommands = useMemo(
    () => (settings.commandPaletteEnabled ?? true) ? buildComposerCommands({
      skills: (settings.skillsEnabled ?? true) ? skills : [],
      t,
      onOpenKnowledge: goKnowledge,
      onOpenModelPicker: () => {
        markChromeActive()
        setShowOptions(true)
      },
      onApplySkill: (skill) => void applySkillToActiveConversation([skill]),
      onCreateDefaultSkill: () => void createDefaultSkill(),
    }) : [],
    [settings.commandPaletteEnabled, settings.skillsEnabled, skills, conversation?.id, t]
  )
  const composerReferences = useMemo(
    () => buildComposerReferences({
      providers,
      skills,
      knowledgeDocuments,
      memoryItems,
      settings,
    }),
    [knowledgeDocuments, memoryItems, providers, settings, skills]
  )
  function scheduleChromeIdleCollapse() {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    if (showOptions || providerHealth?.code || testingHeader) return
    idleTimer.current = setTimeout(() => {
      setChromeCollapsed(true)
    }, 5000)
  }

  function markChromeActive() {
    setChromeCollapsed(false)
    scheduleChromeIdleCollapse()
  }

  function applyQuickStartDraft(draft: string) {
    quickStartSequence.current += 1
    setQuickStartDraft({ content: draft, key: `composer-draft-${quickStartSequence.current}` })
    setShowOptions(false)
    setComposerPanel(null)
    setChromeCollapsed(false)
  }

  function collapseQuickTools() {
    setQuickToolsCollapsed(true)
    setComposerPanel(null)
  }

  function toggleQuickTools() {
    const nextCollapsed = !quickToolsCollapsed
    setQuickToolsCollapsed(nextCollapsed)
    if (nextCollapsed) setComposerPanel(null)
  }

  async function applySkillToActiveConversation(nextSkills: SkillDefinition[]) {
    if (!nextSkills.length || !runtimeConversation) return
    const variableValues = await collectSkillVariableValues(nextSkills)
    if (!variableValues) return
    const result = applySkillStack({ conversation: runtimeConversation, skills: nextSkills, variables: variableValues })
    let snapshotProvider: AIProvider | undefined
    if (result.snapshot.providerId && result.snapshot.model) {
      snapshotProvider = providers.find((item) => item.id === result.snapshot.providerId)
      if (!snapshotProvider || !resolveProviderModelAliasAccess({ provider: snapshotProvider, model: result.snapshot.model, settings }).allowed) {
        dialog.toast({ title: t('chat.modelSwitchBlocked'), message: t('chat.modelSwitchBlockedMessage', { model: result.snapshot.model, provider: snapshotProvider?.name ?? result.snapshot.providerId }), tone: 'danger' })
        return
      }
    }
    updateConversation(runtimeConversation.id, result.conversationUpdates)
    if (result.snapshot.providerId && result.snapshot.model) {
      const switched = switchConversationModel(runtimeConversation.id, result.snapshot.providerId, result.snapshot.model)
      if (!switched) {
        dialog.toast({ title: t('chat.modelSwitchBlocked'), message: t('chat.modelSwitchBlockedMessage', { model: result.snapshot.model, provider: snapshotProvider?.name ?? result.snapshot.providerId }), tone: 'danger' })
        return
      }
    }
    if (result.snapshot.firstUserMessage?.trim()) applyQuickStartDraft(result.snapshot.firstUserMessage)
    dialog.toast({ title: t('skills.applied'), message: result.snapshot.names.join(' + '), tone: 'mint' })
  }

  async function collectSkillVariableValues(nextSkills: SkillDefinition[]): Promise<Record<string, string | number | boolean> | null> {
    const defaults = collectSkillVariableDefaults(nextSkills)
    const variableNames = Array.from(new Set(nextSkills.flatMap((skill) => extractSkillVariables(skill)))).sort()
    if (!variableNames.length) return defaults
    const valuesRef = { current: Object.fromEntries(variableNames.map((name) => [name, String(defaults[name] ?? '')])) as Record<string, string> }
    const confirmed = await dialog.confirm({
      title: t('skills.fillVariables'),
      message: t('skills.fillVariablesMessage'),
      confirmLabel: t('common.confirm'),
      cancelLabel: t('common.cancel'),
      renderBody: () => (
        <SkillVariableDialogBody
          variableNames={variableNames}
          initialValues={valuesRef.current}
          onChange={(values) => {
            valuesRef.current = values
          }}
        />
      ),
    })
    if (!confirmed) return null
    return { ...defaults, ...valuesRef.current }
  }

  async function createDefaultSkill() {
    const skill = await upsertSkill(createBaseSkill({
      name: t('skills.defaultChineseName'),
      systemPrompt: t('skills.defaultChinesePrompt'),
      tags: ['language', 'zh-CN'],
      priority: 10,
    }))
    setSkills((items) => [skill, ...items.filter((item) => item.id !== skill.id)])
    await applySkillToActiveConversation([skill])
  }

  useEffect(() => {
    const now = Date.now()
    const wait = Math.max(32, AUTO_SCROLL_DELAY_MS - (now - lastAutoScrollAt.current))
    if (autoScrollTimer.current) clearTimeout(autoScrollTimer.current)
    autoScrollTimer.current = setTimeout(() => {
      if (!autoStickToBottom.current) return
      lastAutoScrollAt.current = Date.now()
      listRef.current?.scrollToEnd({ animated: false })
    }, wait)
    return () => {
      if (autoScrollTimer.current) clearTimeout(autoScrollTimer.current)
    }
  }, [composerHeight, keyboardHeight, messageSignature])

  useEffect(() => {
    let mounted = true
    void resolveConversationHealth(runtimeConversation, providers, hydrateProviderKey, t, settings).then((health) => {
      if (mounted) setProviderHealth(health)
    })
    return () => {
      mounted = false
    }
  }, [
    conversation?.id,
    runtimeConversation?.providerId,
    runtimeConversation?.model,
    runtimeConversation?.providerModelMode,
    hydrateProviderKey,
    providerHealthKey,
  ])

  useEffect(() => {
    if (!conversation?.id) return
    collapseQuickTools()
    recoverStaleStreamingMessages(conversation.id)
  }, [conversation?.id])

  useEffect(() => {
    if (conversation) return
    setSetupReasoningEffort((current) => current === initialSetupDefaults.reasoningEffort ? current : initialSetupDefaults.reasoningEffort)
    setSetupSystemPrompt((current) => current.trim() ? current : initialSetupDefaults.systemPrompt)
  }, [conversation, initialSetupDefaults.reasoningEffort, initialSetupDefaults.systemPrompt])

  useEffect(() => {
    if (!homeProvider) {
      setSetupSelectedProviderId(null)
      setSetupSelectedModel(null)
      return
    }
    if (!setupSelectedProviderId || !quickModelProviders.some((item) => item.id === setupSelectedProviderId)) {
      setSetupSelectedProviderId(homeProvider.id)
    }
    if (setupSelectedModel && homeProviderModels.includes(setupSelectedModel)) return
    setSetupSelectedModel(getPolicyPreferredProviderModel(homeProvider, settings) ?? homeProviderModels[0] ?? null)
  }, [homeProvider?.id, homeProviderModels.join('|'), quickModelProviders, settings, setupSelectedModel, setupSelectedProviderId])

  useEffect(() => {
    if (!isStreaming && pendingStreamingMessage && runtimeConversation) {
      const queued = pendingStreamingMessage
      setPendingStreamingMessage(null)
      void sendMessage({ conversation: runtimeConversation, content: queued.content, attachments: queued.attachments })
        .catch((error) => dialog.toast({ title: t('chat.pendingSendFailed'), message: error instanceof Error ? error.message : t('chat.pendingSendFailedMessage'), tone: 'danger' }))
    }
  }, [dialog, isStreaming, pendingStreamingMessage, runtimeConversation])

  useEffect(() => {
    scheduleChromeIdleCollapse()
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current)
    }
  }, [showOptions, providerHealth?.code, testingHeader])

  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (event) => {
      setKeyboardHeight(event.endCoordinates.height)
    })
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      setKeyboardHeight(0)
    })
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])

  useEffect(() => {
    setPagerGestureLocked?.(showOptions || !!composerPanel || composerFocused)
    return () => setPagerGestureLocked?.(false)
  }, [composerFocused, composerPanel, setPagerGestureLocked, showOptions])

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (showOptions) {
        setShowOptions(false)
        return true
      }
      if (composerPanel) {
        setComposerPanel(null)
        return true
      }
      if (intentDraft) {
        setIntentDraft(null)
        return true
      }
      return false
    })
    return () => subscription.remove()
  }, [composerPanel, intentDraft, showOptions])

  useEffect(() => {
    let mounted = true
    async function loadComposerSources() {
      const [skillItems, documents, memories] = await Promise.all([
        listSkills(),
        listKnowledgeDocuments().catch(() => []),
        listMemories(['active', 'pending']).catch(() => []),
      ])
      if (!mounted) return
      setSkills(skillItems)
      setKnowledgeDocuments(documents)
      setMemoryItems(memories)
    }
    void loadComposerSources()
    return () => {
      mounted = false
    }
  }, [providers.length, conversation?.id, conversation?.messages.length])

  if (!conversation) {
    async function submitSetup(content: string, attachments: Attachment[]) {
      const currentSettings = useSettingsStore.getState().settings
      const readyProvider = homeProvider ?? pickReadyProviderForNewConversation(useSettingsStore.getState().providers, currentSettings.defaultProvider, currentSettings)
      if (!readyProvider) {
        if (hasEnabledProvider && !hasAvailableModel) {
          dialog.toast({ title: t('chat.noAvailableModels'), message: t('chat.syncModelsBeforeChat'), tone: 'amber' })
          goProviders()
          return
        }
        dialog.toast({ title: t('chat.noProviderConnected'), message: t('chat.configureProviderBeforeChat'), tone: 'amber' })
        goProviders()
        return
      }
      const providerModels = getPolicyAllowedProviderModels(readyProvider, currentSettings)
      const model = providerModels.includes(setupModel) ? setupModel : getPolicyPreferredProviderModel(readyProvider, currentSettings)
      if (!model) return
      const id = createConversation(readyProvider.id, model)
      updateConversation(id, { systemPrompt: setupSystemPrompt, reasoningEffort: setupReasoningEffort, temperature: setupTemperature })
      const nextConversation = useChatStore.getState().conversations.find((item) => item.id === id)
      if (nextConversation) {
        try {
          await sendMessage({ conversation: { ...nextConversation, systemPrompt: setupSystemPrompt, reasoningEffort: setupReasoningEffort, temperature: setupTemperature }, content, attachments })
        } catch (error) {
          dialog.toast({ title: t('chat.sendFailed'), message: error instanceof Error ? error.message : t('chat.sendFailedMessage'), tone: 'danger' })
        }
      }
    }

    function openSetupModelPicker() {
      markChromeActive()
      if (!homeProvider || !homeProviderModels.length) {
        dialog.toast({
          title: t('chat.noAvailableModels'),
          message: hasEnabledProvider ? t('chat.syncModelsBeforeChat') : t('chat.configureProviderBeforeChat'),
          tone: 'amber',
        })
      }
      setComposerPanel((current) => current === 'model' ? null : 'model')
    }

    function openSetupReasoningPicker() {
      markChromeActive()
      if (!supportsSetupReasoningQuick) {
        dialog.toast({
          title: t('chat.quickReasoning'),
          message: hasAvailableModel ? t('chat.reasoningUnsupported') : t('chat.syncModelsBeforeChat'),
          tone: 'amber',
        })
      }
      setComposerPanel((current) => current === 'reasoning' ? null : 'reasoning')
    }

    function openSetupFullModelPanel() {
      markChromeActive()
      setShowOptions(true)
      setComposerPanel(null)
      if (!switchableProviders.length) {
        dialog.toast({ title: t('chat.noProviderConnected'), message: t('chat.configureProviderBeforeChat'), tone: 'amber' })
      }
    }

    function switchSetupModel(nextModel: string) {
      if (!homeProvider) return
      if (!resolveProviderModelAliasAccess({ provider: homeProvider, model: nextModel, settings }).allowed) {
        dialog.toast({ title: t('chat.modelSwitchBlocked'), message: t('chat.modelSwitchBlockedMessage', { model: nextModel, provider: homeProvider.name }), tone: 'danger' })
        return
      }
      setSetupSelectedModel(nextModel)
      setComposerPanel(null)
      dialog.toast({ title: t('chat.modelSwitched'), message: `${homeProvider.name} · ${getProviderDisplayModel(homeProvider, nextModel)}`, tone: 'mint' })
    }

    return (
      <ChatScreenFrame embedded={embedded} backgroundState={backgroundState} compactViewport={compactViewport}>
        <View style={{ flex: 1 }}>
          {showOptions ? (
            <MotiView
              from={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1 }}
              style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 55 }}
            >
              <IsleOverlayPressable
                accessibilityLabel={t('dialog.closeLayer')}
                onPress={() => setShowOptions(false)}
                style={{ flex: 1, backgroundColor: colors.backdrop }}
              />
            </MotiView>
          ) : null}
          <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 40, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <AnimatedNavigationTrigger
              variant="iconButton"
              label={t('conversation.title')}
              glyph="history"
              onNavigate={goHistory}
              color={colors.text}
              style={{ width: 44, height: 44, borderRadius: colors.ui.radius.controlLarge, backgroundColor: colors.material.paperRaised, borderWidth: 1, borderColor: colors.border }}
            />
            <View style={{ flex: 1 }}>
              <Pressable onPress={openSetupFullModelPanel} accessibilityRole="button" accessibilityLabel={t('chat.conversationOptions')} style={{ minHeight: 44, justifyContent: 'center' }}>
                <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>{emptyHeaderTitle}</Text>
                {emptyHeaderSubtitle ? (
                  <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                    {emptyHeaderSubtitle}
                  </Text>
                ) : null}
              </Pressable>
            </View>
            <IslePressable
              haptic
              onPress={openSetupFullModelPanel}
              accessibilityLabel={t('chat.conversationOptions')}
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: colors.ui.radius.controlLarge, backgroundColor: colors.material.chrome, borderWidth: 1, borderColor: colors.borderStrong }}
            >
              <ListEnd color={colors.text} size={18} strokeWidth={1.9} />
            </IslePressable>
            <AnimatedNavigationTrigger
              variant="iconButton"
              label={t('settings.title')}
              glyph="settings-sliders"
              onNavigate={goSettings}
              externalActive={settingsTransitionActive}
              color={colors.text}
              style={{ width: 44, height: 44, borderRadius: colors.ui.radius.controlLarge, backgroundColor: colors.material.chrome, borderWidth: 1, borderColor: colors.borderStrong }}
            />
          </View>
          <ScrollView
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              flexGrow: 1,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 20,
              paddingTop: Math.max(insets.top + 92, compactViewport ? 104 : 126),
              paddingBottom: composerBottomInset + keyboardLift,
            }}
          >
            <SetupEmptyState
              description={hasAvailableModel ? t('chat.askAnything') : hasEnabledProvider ? t('chat.syncModelsBeforeChat') : t('chat.configureProviderBeforeChat')}
              actionLabel={hasAvailableModel ? t('chat.startChat') : t('chat.configureProviders')}
              glyph={hasAvailableModel ? 'new-chat' : 'provider-key'}
              onAction={hasAvailableModel ? () => {
                const currentSettings = useSettingsStore.getState().settings
                const readyProvider = pickReadyProviderForNewConversation(useSettingsStore.getState().providers, currentSettings.defaultProvider, currentSettings)
                const model = readyProvider ? getPolicyPreferredProviderModel(readyProvider, currentSettings) : undefined
                if (readyProvider && model) createConversation(readyProvider.id, model)
              } : goProviders}
            />
          </ScrollView>
          {showOptions ? (
            <MotiView
              from={motion === 'full' ? { opacity: 0, translateY: -8, scale: 0.985 } : { opacity: 0 }}
              animate={{ opacity: 1, translateY: 0, scale: 1 }}
              transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.settle } : { type: 'timing', duration: motionTokens.duration.fast }}
              style={optionsPanelOverlayStyle(optionsPanelPlacement, insets.top, insets.bottom)}
            >
              <IsleOverlayPressable onPress={(event) => event.stopPropagation()}>
                <ChatOptionsPanel
                  conversation={setupConversation}
                  provider={homeProvider ?? undefined}
                  switchableProviders={switchableProviders}
                  colors={colors}
                  maxHeight={optionsPanelHeight}
                  placement={optionsPanelPlacement}
                  settings={settings}
                  onSwitchModel={(nextProvider, nextModel) => {
                    if (!resolveProviderModelAliasAccess({ provider: nextProvider, model: nextModel, settings }).allowed) {
                      dialog.toast({ title: t('chat.modelSwitchBlocked'), message: t('chat.modelSwitchBlockedMessage', { model: nextModel, provider: nextProvider.name }), tone: 'danger' })
                      return
                    }
                    setSetupSelectedProviderId(nextProvider.id)
                    setSetupSelectedModel(nextModel)
                    dialog.toast({ title: t('chat.modelSwitched'), message: `${nextProvider.name} · ${getProviderDisplayModel(nextProvider, nextModel)}`, tone: 'mint' })
                    setShowOptions(false)
                  }}
                  onCopyLink={() => dialog.toast({ title: t('chat.noProviderConnected'), message: t('chat.configureProviderBeforeChat'), tone: 'amber' })}
                  onClose={() => setShowOptions(false)}
                  onDraftChange={(updates) => {
                    if (updates.systemPrompt !== undefined) setSetupSystemPrompt(updates.systemPrompt)
                    if (updates.reasoningEffort !== undefined) setSetupReasoningEffort(updates.reasoningEffort)
                  }}
                />
              </IsleOverlayPressable>
            </MotiView>
          ) : null}
          <FloatingComposer
            insets={insets}
            streaming={false}
            activityLabel=""
            initialDraft={effectiveInitialDraft}
            initialDraftKey={effectiveInitialDraftKey}
            commands={composerCommands}
            references={composerReferences}
            reasoningEffort={setupReasoningEffort}
            provider={homeProvider ?? undefined}
            modelProviders={quickModelProviders}
            conversation={setupConversation}
            showReasoning
            onReasoningChange={setSetupReasoningEffort}
            systemPrompt={setupSystemPrompt}
            onSystemPromptChange={setSetupSystemPrompt}
            onSwitchModel={switchSetupModel}
            onSwitchProviderModel={(nextProvider, nextModel) => {
              if (!resolveProviderModelAliasAccess({ provider: nextProvider, model: nextModel, settings }).allowed) {
                dialog.toast({ title: t('chat.modelSwitchBlocked'), message: t('chat.modelSwitchBlockedMessage', { model: nextModel, provider: nextProvider.name }), tone: 'danger' })
                return
              }
              setSetupSelectedProviderId(nextProvider.id)
              setSetupSelectedModel(nextModel)
              setComposerPanel(null)
              dialog.toast({ title: t('chat.modelSwitched'), message: `${nextProvider.name} · ${getProviderDisplayModel(nextProvider, nextModel)}`, tone: 'mint' })
            }}
            onOpenModelPicker={openSetupModelPicker}
            onOpenAdvancedModelPicker={openSetupFullModelPanel}
            onOpenKnowledge={goKnowledge}
            onClearPending={() => undefined}
            disabled={false}
            onStop={() => undefined}
            onReferenceSelected={() => undefined}
            onSend={(content, attachments) => {
              collapseQuickTools()
              return submitSetup(content, attachments)
            }}
            onSendWhileStreaming={(content, attachments) => {
              collapseQuickTools()
              return submitSetup(content, attachments)
            }}
            onInteract={() => {
              setPagerGestureLocked?.(true)
              if (showOptions) setShowOptions(false)
            }}
            onInteractEnd={() => {
              if (!showOptions && !composerPanel && !composerFocused) setPagerGestureLocked?.(false)
            }}
            onInputFocus={() => {
              collapseQuickTools()
              setComposerFocused(true)
            }}
            onInputBlur={() => setComposerFocused(false)}
            keyboardLift={keyboardLift}
            panel={composerPanel}
            onPanelChange={setComposerPanel}
            toolsCollapsed={quickToolsCollapsed}
            onToggleTools={toggleQuickTools}
            onCollapseTools={collapseQuickTools}
            onOpenReasoningPicker={openSetupReasoningPicker}
            reasoningUnavailableMessage={supportsSetupReasoningQuick ? undefined : (hasAvailableModel ? t('chat.reasoningUnsupported') : t('chat.syncModelsBeforeChat'))}
            onLayoutHeight={setComposerHeight}
            motion={motion}
            settings={settings}
          />
        </View>
      </ChatScreenFrame>
    )
  }

  if (!runtimeConversation) return null
  return (
    <ActiveChatWorkspace
      conversation={runtimeConversation}
      provider={provider}
      providerHealth={providerHealth}
      testingHeader={testingHeader}
      showOptions={showOptions}
      chromeCollapsed={chromeCollapsed}
      isStreaming={isStreaming}
      activityLabel={activityLabel}
      pendingNotice={pendingNotice}
      initialDraft={effectiveInitialDraft}
      initialDraftKey={effectiveInitialDraftKey}
      intentDraft={intentDraft}
      composerCommands={composerCommands}
      composerReferences={composerReferences}
      supportsReasoningQuick={supportsReasoningQuick}
      reasoningEffort={reasoningEffort}
      metrics={metrics}
      regenerableAssistantId={regenerableAssistantId}
      switchableProviders={switchableProviders}
      readyProviders={quickModelProviders}
      optionsPanelHeight={optionsPanelHeight}
      optionsPanelPlacement={optionsPanelPlacement}
      composerBottomInset={composerBottomInset}
      insets={insets}
      colors={colors}
      embedded={embedded}
      backgroundState={backgroundState}
      compactViewport={compactViewport}
      showBack={showBack}
      goHistory={goHistory}
      goSettings={goSettings}
      goProviders={goProviders}
      goKnowledge={goKnowledge}
      onApplyStarter={applyQuickStartDraft}
      updateConversation={updateConversation}
      switchConversationModel={switchConversationModel}
      removeMessage={removeMessage}
      hydrateProviderKey={hydrateProviderKey}
      updateProvider={updateProvider}
      dialog={dialog}
      listRef={listRef}
      setShowOptions={setShowOptions}
      setChromeCollapsed={setChromeCollapsed}
      setPendingStreamingMessage={setPendingStreamingMessage}
      setIntentDraft={setIntentDraft}
      setProviderHealth={setProviderHealth}
      setTestingHeader={setTestingHeader}
      composerPanel={composerPanel}
      setComposerPanel={setComposerPanel}
      setComposerHeight={setComposerHeight}
      quickToolsCollapsed={quickToolsCollapsed}
      toggleQuickTools={toggleQuickTools}
      collapseQuickTools={collapseQuickTools}
      motion={motion}
      markChromeActive={markChromeActive}
      scheduleChromeIdleCollapse={scheduleChromeIdleCollapse}
      lastScrollOffset={lastScrollOffset}
      autoStickToBottom={autoStickToBottom}
      keyboardLift={keyboardLift}
      keyboardVisible={keyboardVisible}
      settings={settings}
      setComposerFocused={setComposerFocused}
      setPagerGestureLocked={setPagerGestureLocked}
      settingsTransitionActive={settingsTransitionActive}
    />
  )
}

function ActiveChatWorkspace({
  conversation: activeConversation,
  provider,
  providerHealth,
  testingHeader,
  showOptions,
  chromeCollapsed,
  isStreaming,
  activityLabel,
  pendingNotice,
  initialDraft,
  initialDraftKey,
  intentDraft,
  composerCommands,
  composerReferences,
  supportsReasoningQuick,
  reasoningEffort,
  metrics,
  regenerableAssistantId,
  switchableProviders,
  readyProviders,
  optionsPanelHeight,
  optionsPanelPlacement,
  composerBottomInset,
  insets,
  colors,
  embedded,
  backgroundState,
  compactViewport,
  showBack,
  goHistory,
  goSettings,
  goProviders,
  goKnowledge,
  onApplyStarter,
  updateConversation,
  switchConversationModel,
  removeMessage,
  hydrateProviderKey,
  updateProvider,
  dialog,
  listRef,
  setShowOptions,
  setChromeCollapsed,
  setPendingStreamingMessage,
  setIntentDraft,
  setProviderHealth,
  setTestingHeader,
  composerPanel,
  setComposerPanel,
  setComposerHeight,
  quickToolsCollapsed,
  toggleQuickTools,
  collapseQuickTools,
  motion,
  markChromeActive,
  scheduleChromeIdleCollapse,
  lastScrollOffset,
  autoStickToBottom,
  keyboardLift,
  keyboardVisible,
  settings,
  setComposerFocused,
  setPagerGestureLocked,
  settingsTransitionActive,
}: {
  conversation: Conversation
  provider: AIProvider | undefined
  providerHealth: ConversationHealth | null
  testingHeader: boolean
  showOptions: boolean
  chromeCollapsed: boolean
  isStreaming: boolean
  activityLabel: string
  pendingNotice?: string
  initialDraft?: string
  initialDraftKey?: string | number
  intentDraft: { content: string; attachments: Attachment[] } | null
  composerCommands: ComposerCommand[]
  composerReferences: CommandReference[]
  supportsReasoningQuick: boolean
  reasoningEffort: NonNullable<Conversation['reasoningEffort']>
  metrics: ConversationMetrics
  regenerableAssistantId?: string
  switchableProviders: AIProvider[]
  readyProviders: AIProvider[]
  optionsPanelHeight: number
  optionsPanelPlacement: ChatOptionsPlacement
  composerBottomInset: number
  insets: ReturnType<typeof useSafeAreaInsets>
  colors: ReturnType<typeof useAppTheme>['colors']
  embedded: boolean
  backgroundState: IsleBackgroundState
  compactViewport: boolean
  showBack: boolean
  goHistory: () => void
  goSettings: () => void
  goProviders: () => void
  goKnowledge: () => void
  onApplyStarter: (draft: string) => void
  updateConversation: (id: string, updates: Partial<Conversation>) => void
  switchConversationModel: (id: string, providerId: string, model: string) => boolean
  removeMessage: (convId: string, msgId: string) => void
  hydrateProviderKey: (id: string) => Promise<AIProvider | null>
  updateProvider: (id: string, updates: Partial<AIProvider>) => Promise<void>
  dialog: ReturnType<typeof useIsleDialog>
  listRef: React.RefObject<FlashListRef<Message> | null>
  setShowOptions: React.Dispatch<React.SetStateAction<boolean>>
  setChromeCollapsed: React.Dispatch<React.SetStateAction<boolean>>
  setPendingStreamingMessage: React.Dispatch<React.SetStateAction<PendingStreamingMessage | null>>
  setIntentDraft: React.Dispatch<React.SetStateAction<{ content: string; attachments: Attachment[] } | null>>
  setProviderHealth: React.Dispatch<React.SetStateAction<ConversationHealth | null>>
  setTestingHeader: React.Dispatch<React.SetStateAction<boolean>>
  composerPanel: ComposerPanel
  setComposerPanel: React.Dispatch<React.SetStateAction<ComposerPanel>>
  setComposerHeight: React.Dispatch<React.SetStateAction<number>>
  quickToolsCollapsed: boolean
  toggleQuickTools: () => void
  collapseQuickTools: () => void
  motion: ReturnType<typeof useMotionPreference>
  markChromeActive: () => void
  scheduleChromeIdleCollapse: () => void
  lastScrollOffset: React.MutableRefObject<number>
  autoStickToBottom: React.MutableRefObject<boolean>
  keyboardLift: number
  keyboardVisible: boolean
  settings: ReturnType<typeof useSettingsStore.getState>['settings']
  setComposerFocused: React.Dispatch<React.SetStateAction<boolean>>
  setPagerGestureLocked?: (locked: boolean) => void
  settingsTransitionActive: boolean
}) {
  const { t } = useTranslation()
  const [showJumpToBottom, setShowJumpToBottom] = useState(false)
  const [chromeHeight, setChromeHeight] = useState(0)
  const emptyConversationTopPadding = Math.max(
    EMPTY_CONVERSATION_DEFAULT_TOP_PADDING,
    chromeCollapsed
      ? COLLAPSED_CHROME_TOP_OFFSET + COLLAPSED_CHROME_HEIGHT + EMPTY_CONVERSATION_CHROME_GAP
      : chromeHeight + EMPTY_CONVERSATION_CHROME_GAP
  )

  async function submit(content: string, attachments: Attachment[]) {
    scrollToLatestMessage(false, 0)
    try {
      await sendMessage({ conversation: activeConversation, content, attachments })
    } catch (error) {
      dialog.toast({ title: t('chat.sendFailed'), message: error instanceof Error ? error.message : t('chat.sendFailedMessage'), tone: 'danger' })
    }
  }

  function rememberCommandReference(reference: CommandReference) {
    const existing = activeConversation.commandRefs ?? []
    if (existing.some((item) => item.type === reference.type && item.id === reference.id)) return
    updateConversation(activeConversation.id, { commandRefs: [reference, ...existing].slice(0, 12) })
  }

  async function submitWhileStreaming(content: string, attachments: Attachment[]) {
    setIntentDraft({ content, attachments })
  }

  async function applyStreamingIntent(intent: StreamingInputIntent) {
    if (!intentDraft) return
    const draft = intentDraft
    setIntentDraft(null)
    if (intent === 'interrupt') {
      scrollToLatestMessage(false, 0)
      safeStopMessage(activeConversation.id)
      setPendingStreamingMessage(null)
      setTimeout(() => {
        const latestConversation = useChatStore.getState().conversations.find((item) => item.id === activeConversation.id)
        if (latestConversation) {
          void sendMessage({ conversation: latestConversation, content: draft.content, attachments: draft.attachments })
            .catch((error) => dialog.toast({ title: t('chat.sendFailed'), message: error instanceof Error ? error.message : t('chat.interruptedSendFailedMessage'), tone: 'danger' }))
        }
      }, 30)
      return
    }
    scrollToLatestMessage(false, 0)
    setPendingStreamingMessage({ intent, content: draft.content, attachments: draft.attachments })
  }

  async function testCurrentModel(message: Message) {
    const providerId = message.errorProviderId ?? activeConversation.providerId
    const keyedProvider = await hydrateProviderKey(providerId)
    if (!keyedProvider?.apiKey) {
      goSettings()
      return
    }
    const result = await testProviderModelDetailed(keyedProvider, activeConversation.model, keyedProvider.apiKey, { checkParameters: settings.modelTestCheckParameters })
    await useSettingsStore.getState().updateProviderCredentialGroupHealth(keyedProvider.id, result.credentialGroupId, result.ok)
    await updateProvider(keyedProvider.id, { lastTestStatus: result.ok ? 'ok' : 'bad', lastTestedAt: Date.now(), lastTestMessage: result.message, lastTestCode: result.code })
    dialog.toast({ title: result.ok ? t('chat.modelAvailable') : t('chat.modelUnavailable'), message: result.ok ? t('chat.modelTestPassed', { model: activeConversation.model }) : result.message, tone: result.ok ? 'mint' : 'danger' })
  }

  async function testHeaderModel() {
    if (testingHeader) return
    setTestingHeader(true)
    const keyedProvider = await hydrateProviderKey(activeConversation.providerId)
    if (!keyedProvider?.apiKey) {
      setTestingHeader(false)
      goSettings()
      return
    }
    const result = await testProviderModelDetailed(keyedProvider, activeConversation.model, keyedProvider.apiKey, { checkParameters: settings.modelTestCheckParameters })
    await useSettingsStore.getState().updateProviderCredentialGroupHealth(keyedProvider.id, result.credentialGroupId, result.ok)
    await updateProvider(keyedProvider.id, {
      lastTestStatus: result.ok ? 'ok' : 'bad',
      lastTestedAt: Date.now(),
      lastTestModel: activeConversation.model,
      lastTestMessage: result.message,
      lastTestCode: result.code,
    })
    const currentState = useSettingsStore.getState()
    setProviderHealth(await resolveConversationHealth(activeConversation, currentState.providers, hydrateProviderKey, t, currentState.settings))
    setTestingHeader(false)
    dialog.toast({ title: result.ok ? t('chat.modelAvailable') : t('chat.modelUnavailable'), message: result.ok ? t('chat.modelTestPassed', { model: activeConversation.model }) : result.message, tone: result.ok ? 'mint' : 'danger' })
  }

  function confirmSwitchModel(nextProvider: AIProvider, nextModel: string) {
    if (nextProvider.id === activeConversation.providerId && nextModel === activeConversation.model) return
    const access = resolveProviderModelAliasAccess({ provider: nextProvider, model: nextModel, settings })
    if (!access.allowed) {
      dialog.toast({ title: t('chat.modelSwitchBlocked'), message: t('chat.modelSwitchBlockedMessage', { model: nextModel, provider: nextProvider.name }), tone: 'danger' })
      return
    }
    void (async () => {
      safeStopMessage(activeConversation.id)
      const switched = switchConversationModel(activeConversation.id, nextProvider.id, nextModel)
      if (!switched) {
        dialog.toast({ title: t('chat.modelSwitchBlocked'), message: t('chat.modelSwitchBlockedMessage', { model: nextModel, provider: nextProvider.name }), tone: 'danger' })
        return
      }
      setShowOptions(false)
      setComposerPanel(null)
      dialog.toast({ title: t('chat.modelSwitched'), message: `${nextProvider.name} · ${getProviderDisplayModel(nextProvider, nextModel)}`, tone: 'mint' })
    })()
  }

  function safeStopMessage(conversationId: string) {
    try {
      stopMessage(conversationId)
    } catch (error) {
      dialog.toast({ title: t('chat.stopFailed'), message: error instanceof Error ? error.message : t('chat.stopFailedMessage'), tone: 'danger' })
    }
  }

  async function copyConversationLink() {
    const url = Linking.createURL(`/chat/${activeConversation.id}`)
    await Clipboard.setStringAsync(url)
    dialog.toast({ title: t('chat.linkCopied'), message: url, tone: 'mint' })
  }

  function handleListScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const y = event.nativeEvent.contentOffset.y
    const delta = y - lastScrollOffset.current
    const distanceFromBottom = Math.max(
      0,
      event.nativeEvent.contentSize.height - event.nativeEvent.layoutMeasurement.height - y
    )
    if (distanceFromBottom <= USER_SCROLL_PAUSE_THRESHOLD) {
      autoStickToBottom.current = true
      setShowJumpToBottom(false)
    } else if (delta < -8) {
      autoStickToBottom.current = false
      setShowJumpToBottom(true)
    }
    if (delta < -10 || y < 18) {
      markChromeActive()
    } else if (Math.abs(delta) > 8) {
      scheduleChromeIdleCollapse()
    }
    lastScrollOffset.current = y
  }

  function closeOptionsFromBackground() {
    if (showOptions) setShowOptions(false)
    if (composerPanel) setComposerPanel(null)
  }

  function scrollToLatestMessage(animated = true, delay = 80) {
    autoStickToBottom.current = true
    setShowJumpToBottom(false)
    setTimeout(() => {
      listRef.current?.scrollToEnd({ animated })
    }, delay)
  }

  return (
    <ChatScreenFrame embedded={embedded} backgroundState={backgroundState} compactViewport={compactViewport}>
        <View style={{ flex: 1 }}>
          {showOptions ? (
            <MotiView
              from={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1 }}
              style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 55 }}
            >
              <IsleOverlayPressable
                accessibilityLabel={t('dialog.closeLayer')}
                onPress={() => setShowOptions(false)}
                style={{ flex: 1, backgroundColor: colors.backdrop }}
              />
            </MotiView>
          ) : null}
          <FloatingChrome
            colors={colors}
            insets={insets}
            collapsed={chromeCollapsed}
            streaming={isStreaming}
            showOptions={showOptions}
            conversation={activeConversation}
            provider={provider}
            providerHealth={providerHealth}
            metrics={metrics}
            onBack={() => (showBack ? router.back() : goHistory())}
            onRestore={markChromeActive}
            onToggleOptions={() => {
              markChromeActive()
              setShowOptions((value) => !value)
            }}
            onCloseOptions={() => setShowOptions(false)}
            onSettings={() => {
              markChromeActive()
              goSettings()
            }}
            onTestModel={() => void testHeaderModel()}
            onSwitchModel={confirmSwitchModel}
            onCopyLink={() => void copyConversationLink()}
            testingHeader={testingHeader}
            switchableProviders={switchableProviders}
            optionsPanelHeight={optionsPanelHeight}
            optionsPanelPlacement={optionsPanelPlacement}
            onLayoutHeight={setChromeHeight}
            motion={motion}
            settings={settings}
            settingsTransitionActive={settingsTransitionActive}
          />

          <View onTouchStart={closeOptionsFromBackground} style={{ flex: 1 }}>
            <FlashList
              ref={listRef}
              style={{ flex: 1 }}
              data={activeConversation.messages}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              onScroll={handleListScroll}
              scrollEventThrottle={16}
              contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 44 + composerBottomInset + keyboardLift }}
              ListHeaderComponent={renderConversationHeaderSpacer(providerHealth, colors, t)}
              renderItem={({ item: message, index }) => (
                <MessageBubble
                  key={message.id}
                  conversationId={activeConversation.id}
                  message={message}
                  index={index}
                  isLastAssistant={message.id === regenerableAssistantId}
                  onCopy={(item) => {
                    void copyMessageFinalText(item)
                      .then(() => dialog.toast({ title: t('common.copied'), message: t('chat.messageCopied'), tone: 'mint' }))
                      .catch(() => dialog.toast({ title: t('common.copyFailed'), message: t('chat.clipboardUnavailable'), tone: 'danger' }))
                  }}
                  onCopyWorkArtifact={(item) => {
                    const workArtifact = summarizeWorkArtifact(item.responseText ?? item.content)
                    if (!workArtifact.hasWorkArtifact || !workArtifact.handoffText.trim()) {
                      dialog.toast({ title: t('messageBubble.copyWorkArtifactEmpty'), tone: 'amber' })
                      return
                    }
                    void Clipboard.setStringAsync(workArtifact.handoffText)
                      .then(() => dialog.toast({ title: t('common.copied'), message: t('messageBubble.copyWorkArtifactCopied'), tone: 'mint' }))
                      .catch(() => dialog.toast({ title: t('common.copyFailed'), message: t('chat.clipboardUnavailable'), tone: 'danger' }))
                  }}
                  onContinueWorkArtifact={(item) => {
                    const workArtifact = summarizeWorkArtifact(item.responseText ?? item.content)
                    if (!workArtifact.hasWorkArtifact || !workArtifact.followUpPrompt.trim()) {
                      dialog.toast({ title: t('messageBubble.copyWorkArtifactEmpty'), tone: 'amber' })
                      return
                    }
                    onApplyStarter(workArtifact.followUpPrompt)
                    dialog.toast({ title: t('messageBubble.continueWorkArtifactInserted'), tone: 'mint' })
                  }}
                  onRetry={(item) => void retryMessage(activeConversation.id, item.id).catch((error) => dialog.toast({ title: t('chat.retryFailed'), message: error instanceof Error ? error.message : t('chat.retryFailedMessage'), tone: 'danger' }))}
                  onRegenerate={() => void regenerateLastAssistant(activeConversation.id).catch((error) => dialog.toast({ title: t('chat.regenerateFailed'), message: error instanceof Error ? error.message : t('chat.regenerateFailedMessage'), tone: 'danger' }))}
                  onSpeak={(item) => void speakText(item.responseText ?? item.content, provider)}
                  onDelete={(item) => {
                    void dialog.confirm({
                      title: t('messageBubble.deleteConfirmTitle'),
                      message: t('messageBubble.deleteConfirmMessage'),
                      confirmLabel: t('common.delete'),
                      cancelLabel: t('common.cancel'),
                      tone: 'danger',
                    }).then((confirmed) => {
                      if (confirmed) removeMessage(activeConversation.id, item.id)
                    })
                  }}
                  onConfigure={goSettings}
                  onTestModel={(item) => void testCurrentModel(item)}
                />
              )}
              ListEmptyComponent={<EmptyConversationState onHistory={goHistory} onProviders={goProviders} topPadding={emptyConversationTopPadding} />}
            />
          </View>

          {showJumpToBottom ? (
            <View pointerEvents="box-none" style={{ position: 'absolute', right: 18, bottom: composerBottomInset + keyboardLift + 12, zIndex: 46 }}>
              <IslePressable
                haptic
                onPress={() => scrollToLatestMessage()}
                accessibilityLabel={t('chat.jumpToBottom')}
                style={{ minHeight: 44, borderRadius: colors.ui.radius.chip, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.material.chrome, borderWidth: 1, borderColor: colors.borderStrong }}
              >
                <ListEnd color={colors.textSecondary} size={14} strokeWidth={2.1} />
                <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900' }}>{t('chat.jumpToBottom')}</Text>
              </IslePressable>
            </View>
          ) : null}

          {intentDraft ? (
            <StreamingIntentSheet
              draft={intentDraft}
              insets={insets}
              onCancel={() => setIntentDraft(null)}
              onChoose={(intent) => void applyStreamingIntent(intent)}
            />
          ) : null}

          <FloatingComposer
            insets={insets}
            streaming={isStreaming}
            activityLabel={activityLabel}
            pendingNotice={pendingNotice}
            initialDraft={initialDraft}
            initialDraftKey={initialDraftKey}
            commands={composerCommands}
            references={composerReferences}
            reasoningEffort={reasoningEffort}
            provider={provider}
            modelProviders={readyProviders}
            conversation={activeConversation}
            showReasoning={supportsReasoningQuick}
            onReasoningChange={(effort) => updateConversation(activeConversation.id, { reasoningEffort: effort })}
            systemPrompt={activeConversation.systemPrompt}
            onSystemPromptChange={(systemPrompt) => updateConversation(activeConversation.id, { systemPrompt })}
            onSwitchModel={(model) => {
              if (!provider) return
              confirmSwitchModel(provider, model)
            }}
            onSwitchProviderModel={(nextProvider, nextModel) => confirmSwitchModel(nextProvider, nextModel)}
            onOpenModelPicker={() => {
              markChromeActive()
              setComposerPanel((current) => current === 'model' ? null : 'model')
            }}
            onOpenAdvancedModelPicker={() => {
              markChromeActive()
              setShowOptions(true)
              setComposerPanel(null)
            }}
            onOpenKnowledge={goKnowledge}
            onClearPending={() => setPendingStreamingMessage(null)}
            disabled={!provider && activeConversation.providerId !== 'local-setup'}
            onStop={() => safeStopMessage(activeConversation.id)}
            onReferenceSelected={rememberCommandReference}
            onSend={(content, attachments) => {
              collapseQuickTools()
              return submit(content, attachments)
            }}
            onSendWhileStreaming={(content, attachments) => {
              collapseQuickTools()
              return submitWhileStreaming(content, attachments)
            }}
            onInteract={() => {
              setPagerGestureLocked?.(true)
              if (showOptions) setShowOptions(false)
            }}
            onInteractEnd={() => {
              if (!showOptions && !composerPanel && !keyboardVisible) setPagerGestureLocked?.(false)
            }}
            onInputFocus={() => {
              collapseQuickTools()
              setComposerFocused(true)
              scrollToLatestMessage(false, 0)
            }}
            onInputBlur={() => setComposerFocused(false)}
            keyboardLift={keyboardLift}
            panel={composerPanel}
            onPanelChange={setComposerPanel}
            toolsCollapsed={quickToolsCollapsed}
            onToggleTools={toggleQuickTools}
            onCollapseTools={collapseQuickTools}
            onLayoutHeight={setComposerHeight}
            motion={motion}
            settings={settings}
          />
        </View>
    </ChatScreenFrame>
  )
}

function ChatScreenFrame({ embedded, backgroundState, compactViewport, children }: PropsWithChildren<{ embedded: boolean; backgroundState: IsleBackgroundState; compactViewport: boolean }>) {
  if (embedded) {
    return <View style={{ flex: 1 }}>{children}</View>
  }

  return (
    <IsleScreen padded={false} background="focus" backgroundState={backgroundState} backgroundIntensity={compactViewport ? 0.84 : 1}>
      {children}
    </IsleScreen>
  )
}

function FloatingChrome({
  colors,
  insets,
  collapsed,
  streaming,
  showOptions,
  conversation,
  provider,
  providerHealth,
  metrics,
  onBack,
  onRestore,
  onToggleOptions,
  onCloseOptions,
  onSettings,
  onTestModel,
  onSwitchModel,
  onCopyLink,
  testingHeader,
  switchableProviders,
  optionsPanelHeight,
  optionsPanelPlacement,
  onLayoutHeight,
  motion,
  settings,
  settingsTransitionActive,
}: {
  colors: ReturnType<typeof useAppTheme>['colors']
  insets: ReturnType<typeof useSafeAreaInsets>
  collapsed: boolean
  streaming: boolean
  showOptions: boolean
  conversation: Conversation
  provider: AIProvider | undefined
  providerHealth: ConversationHealth | null
  metrics: ConversationMetrics
  onBack: () => void
  onRestore: () => void
  onToggleOptions: () => void
  onCloseOptions: () => void
  onSettings: () => void
  onTestModel: () => void
  onSwitchModel: (provider: AIProvider, model: string) => void
  onCopyLink: () => void
  testingHeader: boolean
  switchableProviders: AIProvider[]
  optionsPanelHeight: number
  optionsPanelPlacement: ChatOptionsPlacement
  onLayoutHeight: (height: number) => void
  motion: ReturnType<typeof useMotionPreference>
  settings: ReturnType<typeof useSettingsStore.getState>['settings']
  settingsTransitionActive: boolean
}) {
  const { t } = useTranslation()
  const header = getProviderHeaderState(conversation, provider, switchableProviders, metrics, providerHealth, settings, t)
  const modelLabel = conversation.providerId === 'local-setup' ? t('chat.localSetupGuide') : getProviderDisplayModel(provider, conversation.model)
  const shellStyle: StyleProp<ViewStyle> = [
    {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: showOptions && optionsPanelPlacement === 'sheet' ? 0 : undefined,
      zIndex: showOptions ? 70 : 40,
    },
  ]
  function handleLayout(event: LayoutChangeEvent) {
    onLayoutHeight(Math.ceil(event.nativeEvent.layout.height) + FLOATING_CHROME_TOP_PADDING + FLOATING_CHROME_BOTTOM_PADDING)
  }

  return (
    <View pointerEvents="box-none" style={shellStyle}>
      <MotiView
        pointerEvents={collapsed ? 'none' : 'auto'}
        animate={{ opacity: collapsed ? 0 : 1, translateY: collapsed ? -(insets.top + 78) : 0 }}
        transition={{ type: 'timing', duration: collapsed ? 150 : 210 }}
        style={{ paddingTop: FLOATING_CHROME_TOP_PADDING, paddingHorizontal: 12, paddingBottom: FLOATING_CHROME_BOTTOM_PADDING, zIndex: 1 }}
      >
        <MotiView
          from={{ opacity: 0, translateY: -8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', damping: 22, stiffness: 190 }}
        >
          <View onLayout={handleLayout}>
            <IsleHeader
              title={header.title}
              subtitle={header.subtitle}
              material="transparent"
              elevated={false}
              leading={
                <AnimatedNavigationTrigger variant="iconButton" label={t('common.back')} glyph={showOptions ? 'back' : 'history'} onNavigate={onBack} color={colors.text} />
              }
              trailing={
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <IsleIconButton label={t('chat.conversationOptions')} onPress={onToggleOptions} tone={showOptions ? 'amber' : 'default'}>
                    <ListEnd color={colors.textSecondary} size={17} strokeWidth={2} />
                  </IsleIconButton>
                  <AnimatedNavigationTrigger variant="iconButton" label={t('settings.title')} glyph="settings-sliders" onNavigate={onSettings} externalActive={settingsTransitionActive} color={colors.text} />
                </View>
              }
            />

            {providerHealth?.code ? (
              <ConversationHealthBanner
                health={providerHealth}
                testing={testingHeader}
                onConfigure={onSettings}
                onTest={onTestModel}
                onSwitch={onToggleOptions}
                compact
              />
            ) : null}
          </View>

          {showOptions && optionsPanelPlacement === 'popover' ? (
            <MotiView
              from={motion === 'full' ? { opacity: 0, translateY: -8, scale: 0.985 } : { opacity: 0 }}
              animate={{ opacity: 1, translateY: 0, scale: 1 }}
              transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.settle } : { type: 'timing', duration: motionTokens.duration.fast }}
              style={optionsPanelOverlayStyle(optionsPanelPlacement, insets.top, insets.bottom)}
            >
              <IsleOverlayPressable onPress={(event) => event.stopPropagation()}>
                <ChatOptionsPanel
                  conversation={conversation}
                  provider={provider}
                  switchableProviders={switchableProviders}
                  colors={colors}
                  maxHeight={optionsPanelHeight}
                  placement={optionsPanelPlacement}
                  settings={settings}
                  onSwitchModel={onSwitchModel}
                  onCopyLink={onCopyLink}
                  onClose={onCloseOptions}
                />
              </IsleOverlayPressable>
            </MotiView>
          ) : null}
        </MotiView>
      </MotiView>
      {showOptions && optionsPanelPlacement === 'sheet' ? (
        <MotiView
          from={motion === 'full' ? { opacity: 0, translateY: 18, scale: 0.985 } : { opacity: 0 }}
          animate={{ opacity: 1, translateY: 0, scale: 1 }}
          transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.settle } : { type: 'timing', duration: motionTokens.duration.fast }}
          style={optionsPanelOverlayStyle(optionsPanelPlacement, insets.top, insets.bottom)}
        >
          <IsleOverlayPressable onPress={(event) => event.stopPropagation()}>
            <ChatOptionsPanel
              conversation={conversation}
              provider={provider}
              switchableProviders={switchableProviders}
              colors={colors}
              maxHeight={optionsPanelHeight}
              placement={optionsPanelPlacement}
              settings={settings}
              onSwitchModel={onSwitchModel}
              onCopyLink={onCopyLink}
              onClose={onCloseOptions}
            />
          </IsleOverlayPressable>
        </MotiView>
      ) : null}
      {collapsed ? (
        <MotiView
          from={{ opacity: 0, translateY: -8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', damping: 20, stiffness: 180 }}
          style={{ position: 'absolute', top: COLLAPSED_CHROME_TOP_OFFSET, alignSelf: 'center', zIndex: 8 }}
          pointerEvents="auto"
        >
          <IsleOverlayPressable
            onPress={onRestore}
            accessibilityRole="button"
            accessibilityLabel={t('chat.showTopBar')}
            hitSlop={12}
            style={{ minWidth: streaming ? 136 : 96, minHeight: 44, borderRadius: colors.ui.radius.chip, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.material.chrome, borderWidth: 1, borderColor: colors.border }}
          >
            <Text style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '900' }}>{streaming ? t('chat.generatingShowTopBar') : t('chat.showTopBar')}</Text>
          </IsleOverlayPressable>
        </MotiView>
      ) : null}
    </View>
  )
}

function FloatingComposer({
  insets,
  streaming,
  activityLabel,
  pendingNotice,
  initialDraft,
  initialDraftKey,
  commands,
  references,
  reasoningEffort,
  provider,
  modelProviders,
  conversation,
  showReasoning,
  systemPrompt,
  keyboardLift,
  onReasoningChange,
  onSystemPromptChange,
  onSwitchModel,
  onSwitchProviderModel,
  onOpenModelPicker,
  onOpenReasoningPicker,
  onOpenAdvancedModelPicker,
  onOpenKnowledge,
  onClearPending,
  disabled,
  onStop,
  onReferenceSelected,
  onSend,
  onSendWhileStreaming,
  onInteract,
  onInteractEnd,
  onInputFocus,
  onInputBlur,
  panel,
  onPanelChange,
  toolsCollapsed,
  onToggleTools,
  onCollapseTools,
  reasoningUnavailableMessage,
  onLayoutHeight,
  motion,
  settings,
}: {
  insets: ReturnType<typeof useSafeAreaInsets>
  streaming: boolean
  activityLabel: string
  pendingNotice?: string
  initialDraft?: string
  initialDraftKey?: string | number
  commands: ComposerCommand[]
  references: CommandReference[]
  reasoningEffort: NonNullable<Conversation['reasoningEffort']>
  provider: AIProvider | undefined
  modelProviders: AIProvider[]
  conversation: Conversation
  showReasoning: boolean
  systemPrompt: string
  keyboardLift: number
  onReasoningChange: (effort: NonNullable<Conversation['reasoningEffort']>) => void
  onSystemPromptChange: (systemPrompt: string) => void
  onSwitchModel: (model: string) => void
  onSwitchProviderModel?: (provider: AIProvider, model: string) => void
  onOpenModelPicker: () => void
  onOpenReasoningPicker?: () => void
  onOpenAdvancedModelPicker: () => void
  onOpenKnowledge: () => void
  onClearPending: () => void
  disabled: boolean
  onStop: () => void
  onReferenceSelected: (reference: CommandReference) => void
  onSend: (content: string, attachments: Attachment[]) => Promise<void> | void
  onSendWhileStreaming: (content: string, attachments: Attachment[]) => Promise<void> | void
  onInteract?: () => void
  onInteractEnd?: () => void
  onInputFocus?: () => void
  onInputBlur?: () => void
  panel: ComposerPanel
  onPanelChange: (panel: ComposerPanel) => void
  toolsCollapsed: boolean
  onToggleTools: () => void
  onCollapseTools: () => void
  reasoningUnavailableMessage?: string
  onLayoutHeight: (height: number) => void
  motion: ReturnType<typeof useMotionPreference>
  settings: ReturnType<typeof useSettingsStore.getState>['settings']
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const modelOpen = panel === 'model'
  const reasoningOpen = panel === 'reasoning'
  const promptOpen = panel === 'prompt'
  const moreOpen = panel === 'more'
  const reasoningOptions = useMemo(() => getReasoningEffortOptions(provider, conversation.model), [conversation.model, provider])
  const quickModelSourceProviders = useMemo(() => {
    const source = modelProviders.length ? modelProviders : provider ? [provider] : []
    if (!provider) return source
    return [provider, ...source.filter((item) => item.id !== provider.id)]
  }, [modelProviders, provider])
  const quickModels = useMemo(() => buildModelQuickOptions(quickModelSourceProviders, settings), [quickModelSourceProviders, settings])
  const [modelQuickGroup, setModelQuickGroup] = useState<ModelQuickGroup>(() => inferModelFamily(provider, conversation.model))
  const selectedGroup = useMemo(() => {
    if (modelQuickGroup === 'all') return 'all'
    return quickModels.some((option) => option.family === modelQuickGroup) ? modelQuickGroup : 'all'
  }, [modelQuickGroup, quickModels])
  const visibleQuickModels = selectedGroup === 'all'
    ? quickModels
    : quickModels.filter((option) => option.family === selectedGroup)
  const modelPanelEmptyMessage = !provider
    ? t('chat.configureProviderBeforeChat')
    : quickModels.length
      ? t('chat.noQuickModelMatches')
      : t('chat.providerNoModelsSyncHint')
  const visibleQuickGroups = useMemo(
    () => quickModels.length
      ? MODEL_QUICK_GROUPS.filter((group) => group === 'all' || quickModels.some((option) => option.family === group))
      : [],
    [quickModels]
  )

  useEffect(() => {
    const currentFamily = inferModelFamily(provider, conversation.model)
    setModelQuickGroup(currentFamily)
  }, [conversation.model, provider?.id])

  function handleInputFocus() {
    onCollapseTools()
    onInputFocus?.()
  }

  function handleLayout(event: LayoutChangeEvent) {
    if (panel) return
    onLayoutHeight(Math.ceil(event.nativeEvent.layout.height))
  }

  return (
    <View pointerEvents="box-none" onLayout={handleLayout} style={{ position: 'absolute', left: 0, right: 0, bottom: keyboardLift, zIndex: 40 }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
        onTouchStart={onInteract}
        onTouchMove={onInteract}
        onTouchEnd={onInteractEnd}
        onTouchCancel={onInteractEnd}
      >
        <View pointerEvents="box-none" style={{ paddingHorizontal: 14, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 10) + 8 }}>
          <MotiView
            from={motion === 'full' ? { opacity: 0, translateY: 8 } : { opacity: 0 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.gentle } : { type: 'timing', duration: motionTokens.duration.fast }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 7, flexWrap: 'wrap' }}
          >
            <ComposerToolButton label={toolsCollapsed ? t('chat.expandQuickTools') : t('chat.collapseQuickTools')} active={!toolsCollapsed} iconOnly onPress={onToggleTools}>
              <ChevronRight color={toolsCollapsed ? colors.textSecondary : colors.primary} size={16} strokeWidth={2.3} />
            </ComposerToolButton>
            <AnimatePresence>
              {!toolsCollapsed ? (
                <MotiView
                  key="quick-tools"
                  from={motion === 'full' ? { opacity: 0, translateX: -8, translateY: 5, scale: 0.96 } : { opacity: 0 }}
                  animate={{ opacity: 1, translateX: 0, translateY: 0, scale: 1 }}
                  exit={motion === 'full' ? { opacity: 0, translateX: -6, translateY: 4, scale: 0.96 } : { opacity: 0 }}
                  transition={motion === 'full' ? { type: 'spring', damping: 21, stiffness: 230 } : { type: 'timing', duration: 1 }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
                >
                <ComposerToolButton label={t('chat.quickModel')} active={modelOpen} onPress={onOpenModelPicker}>
                  <Bot color={modelOpen ? colors.primary : colors.textSecondary} size={15} strokeWidth={2} />
                </ComposerToolButton>
                <ComposerToolButton label={t('chat.quickReasoning')} active={reasoningOpen} onPress={onOpenReasoningPicker ?? (() => {
                  onPanelChange(reasoningOpen ? null : 'reasoning')
                })}>
                  <SlidersHorizontal color={reasoningOpen ? colors.primary : colors.textSecondary} size={15} strokeWidth={2} />
                </ComposerToolButton>
                <ComposerToolButton label={t('chat.quickPrompt')} active={promptOpen} onPress={() => {
                  onPanelChange(promptOpen ? null : 'prompt')
                }}>
                  <FileText color={promptOpen ? colors.primary : colors.textSecondary} size={15} strokeWidth={2} />
                </ComposerToolButton>
                <ComposerToolButton label={t('chat.quickMore')} active={moreOpen} onPress={() => {
                  onPanelChange(moreOpen ? null : 'more')
                }}>
                  <ChevronRight color={moreOpen ? colors.primary : colors.textSecondary} size={16} strokeWidth={2.2} />
                </ComposerToolButton>
                </MotiView>
              ) : null}
            </AnimatePresence>
            {streaming ? (
              <ComposerToolButton label={t('chat.stopGenerating')} active onPress={onStop}>
                <Square color={colors.primary} size={13} strokeWidth={2.3} fill={colors.primary} />
              </ComposerToolButton>
            ) : null}
            {streaming ? <GenerationStatusPill label={activityLabel || t('chat.generating')} /> : null}
          </MotiView>
          {!toolsCollapsed && modelOpen ? (
            <MotiView
              from={{ opacity: 0, translateY: 4 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'spring', damping: 20, stiffness: 210 }}
              style={{ marginBottom: 7, borderRadius: colors.ui.radius.panel, padding: 10, backgroundColor: colors.material.chrome, borderWidth: 1, borderColor: colors.border }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                {visibleQuickGroups.length ? (
                  <View
                    onTouchStart={onInteract}
                    onTouchMove={onInteract}
                    onTouchEnd={onInteractEnd}
                    onTouchCancel={onInteractEnd}
                    style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}
                  >
                  {visibleQuickGroups.map((group) => (
                    <QuickChoiceButton
                      key={group}
                      label={t(`chat.modelFamilies.${group}`)}
                      active={selectedGroup === group}
                      onPress={() => setModelQuickGroup(group)}
                    />
                  ))}
                  </View>
                ) : (
                  <View style={{ flex: 1 }} />
                )}
                <IslePressable haptic onPress={onOpenAdvancedModelPicker} style={{ minHeight: 44, borderRadius: colors.ui.radius.chip, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.material.paperRaised, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900' }}>{t('chat.advancedModelMenu')}</Text>
                </IslePressable>
              </View>
              {visibleQuickModels.length ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  nestedScrollEnabled
                  onTouchStart={onInteract}
                  onTouchMove={onInteract}
                  onTouchEnd={onInteractEnd}
                  onTouchCancel={onInteractEnd}
                  contentContainerStyle={{ gap: 7, paddingRight: 4 }}
                >
                  {visibleQuickModels.map((option) => {
                    const active = option.provider.id === conversation.providerId && option.model === conversation.model
                    return (
                    <QuickChoiceButton
                      key={option.id}
                      label={getProviderDisplayModel(option.provider, option.model)}
                      active={active}
                      maxWidth={234}
                      onPress={() => {
                        if (option.provider.id === provider?.id) {
                          onSwitchModel(option.model)
                        } else {
                          onSwitchProviderModel?.(option.provider, option.model)
                        }
                      }}
                    />
                    )
                  })}
                </ScrollView>
              ) : (
                <Text style={{ color: colors.textTertiary, fontSize: 12, fontWeight: '800', lineHeight: 17, paddingHorizontal: 4, paddingVertical: 4 }}>
                  {modelPanelEmptyMessage}
                </Text>
              )}
            </MotiView>
          ) : null}
          {!toolsCollapsed && reasoningOpen ? (
            <MotiView
              from={{ opacity: 0, translateY: 4 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'spring', damping: 20, stiffness: 210 }}
              style={{ flexDirection: 'row', gap: 7, marginBottom: 7, padding: 7, borderRadius: colors.ui.radius.field, backgroundColor: colors.material.chrome, borderWidth: 1, borderColor: colors.border }}
            >
              {showReasoning && reasoningOptions.length ? reasoningOptions.map((effort) => (
                <IslePressable
                  key={effort}
                  haptic
                  onPress={() => {
                    onReasoningChange(effort)
                    onPanelChange(null)
                  }}
                  style={{ minHeight: 44, borderRadius: colors.ui.radius.chip, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: reasoningEffort === effort ? colors.ui.control.primaryBackground : colors.material.paperRaised, borderWidth: 1, borderColor: reasoningEffort === effort ? colors.ui.control.primaryBorder : colors.border }}
                >
                  <Text style={{ color: reasoningEffort === effort ? colors.ui.control.primaryForeground : colors.textSecondary, fontSize: 11, fontWeight: '900' }}>
                    {t(`chat.reasoningEffort.${effort}`)}
                  </Text>
                </IslePressable>
              )) : (
                <Text style={{ color: colors.textTertiary, fontSize: 12, fontWeight: '800', lineHeight: 17, paddingHorizontal: 4, paddingVertical: 4 }}>
                  {reasoningUnavailableMessage ?? t('chat.reasoningUnsupported')}
                </Text>
              )}
            </MotiView>
          ) : null}
          {!toolsCollapsed && promptOpen ? (
            <MotiView
              from={{ opacity: 0, translateY: 4 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'spring', damping: 20, stiffness: 210 }}
              style={{ marginBottom: 7, borderRadius: colors.ui.radius.panel, padding: 10, backgroundColor: colors.material.chrome, borderWidth: 1, borderColor: colors.border }}
            >
              <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900', marginBottom: 6 }}>{t('chat.systemPrompt')}</Text>
              <TextInput
                value={systemPrompt}
                onChangeText={onSystemPromptChange}
                onFocus={handleInputFocus}
                onBlur={onInputBlur}
                multiline
                placeholder={t('chat.systemPromptExample')}
                placeholderTextColor={colors.textTertiary}
                style={{ minHeight: 58, maxHeight: 112, borderRadius: colors.ui.radius.field, paddingHorizontal: 12, paddingVertical: 10, color: colors.text, backgroundColor: colors.material.field, borderWidth: 1, borderColor: colors.border, fontSize: 13, lineHeight: 19, textAlignVertical: 'top' }}
              />
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <IslePressable haptic onPress={() => onSystemPromptChange('')} style={{ minHeight: 44, borderRadius: colors.ui.radius.chip, paddingHorizontal: 12, justifyContent: 'center', backgroundColor: colors.material.paperRaised, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900' }}>{t('chat.clearSystemPrompt')}</Text>
                </IslePressable>
                <IslePressable haptic onPress={() => onPanelChange(null)} style={{ minHeight: 44, borderRadius: colors.ui.radius.chip, paddingHorizontal: 12, justifyContent: 'center', backgroundColor: colors.ui.control.primaryBackground, borderWidth: 1, borderColor: colors.ui.control.primaryBorder }}>
                  <Text style={{ color: colors.ui.control.primaryForeground, fontSize: 11, fontWeight: '900' }}>{t('common.done')}</Text>
                </IslePressable>
              </View>
            </MotiView>
          ) : null}
          <Composer
            disabled={disabled}
            streaming={streaming}
            pendingNotice={pendingNotice}
            initialDraft={initialDraft}
            initialDraftKey={initialDraftKey}
            commands={commands}
            references={references}
            utilitiesOpen={moreOpen}
            showInlineUtilities={false}
            onClearPending={onClearPending}
            onReferenceSelected={onReferenceSelected}
            onSend={onSend}
            onSendWhileStreaming={onSendWhileStreaming}
            onFocus={handleInputFocus}
            onBlur={onInputBlur}
            onOpenKnowledge={onOpenKnowledge}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  )
}

function ComposerToolButton({ label, active, iconOnly = false, children, onPress }: { label: string; active: boolean; iconOnly?: boolean; children: ReactNode; onPress: () => void }) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const controlRadius = colors.ui.radius.controlLarge
  return (
    <IslePressable
      haptic
      onPress={onPress}
      accessibilityLabel={label}
      style={{ width: iconOnly ? 44 : undefined, minHeight: 44, borderRadius: controlRadius }}
    >
      <MotiView
        animate={{
          backgroundColor: active ? colors.mintSoft : colors.material.chrome,
          borderColor: active ? colors.primary : colors.border,
          scale: active ? 1.035 : 1,
        }}
        transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.gentle } : { type: 'timing', duration: 1 }}
        style={{
          width: iconOnly ? 44 : undefined,
          minHeight: 44,
          borderRadius: controlRadius,
          paddingHorizontal: iconOnly ? 0 : 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: iconOnly ? 0 : 6,
          borderWidth: 1,
        }}
      >
        {iconOnly ? (
          <MotiView
            animate={{ rotate: active ? '90deg' : '0deg', translateX: active ? 1 : 0, scale: active ? 1.12 : 1 }}
            transition={motion === 'full' ? { type: 'spring', damping: 17, stiffness: 280 } : { type: 'timing', duration: 1 }}
          >
            {children}
          </MotiView>
        ) : children}
        {iconOnly ? null : <Text numberOfLines={1} style={{ color: active ? colors.primary : colors.textSecondary, fontSize: 11, lineHeight: 15, fontWeight: '900', includeFontPadding: false, textAlignVertical: 'center' }}>{label}</Text>}
      </MotiView>
    </IslePressable>
  )
}

function QuickChoiceButton({ label, active, maxWidth, onPress }: { label: string; active: boolean; maxWidth?: number; onPress: () => void }) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const textMaxWidth = maxWidth ? Math.max(24, maxWidth - 24) : undefined
  const activeBackground = colors.ui.control.primaryBackground
  const activeForeground = colors.ui.control.primaryForeground
  return (
    <IslePressable
      haptic
      onPress={onPress}
      accessibilityLabel={label}
      style={{ maxWidth, minHeight: 44, borderRadius: colors.ui.radius.chip, alignItems: 'center', justifyContent: 'center' }}
    >
      <MotiView
        animate={{
          backgroundColor: active ? activeBackground : colors.material.paperRaised,
          borderColor: active ? colors.ui.control.primaryBorder : colors.border,
          scale: active ? 1.025 : 1,
        }}
        transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.gentle } : { type: 'timing', duration: 1 }}
        style={{ minHeight: 44, borderRadius: colors.ui.radius.chip, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1 }}
      >
        <Text numberOfLines={1} ellipsizeMode="tail" style={{ maxWidth: textMaxWidth, color: active ? activeForeground : colors.textSecondary, fontSize: 11, lineHeight: 15, fontWeight: '900', includeFontPadding: false }}>
          {label}
        </Text>
      </MotiView>
    </IslePressable>
  )
}

function GenerationStatusPill({ label }: { label: string }) {
  const { colors } = useAppTheme()
  return (
    <View style={{ minHeight: 44, borderRadius: colors.ui.radius.chip, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: colors.material.chrome, borderWidth: 1, borderColor: colors.border }}>
      <MotiView
        from={{ opacity: 0.35, scale: 0.84 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ loop: true, type: 'timing', duration: 760 }}
        style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary }}
      />
      <Text numberOfLines={1} style={{ maxWidth: 160, color: colors.textSecondary, fontSize: 11, lineHeight: 15, fontWeight: '900', includeFontPadding: false, textAlignVertical: 'center' }}>
        {label}
      </Text>
    </View>
  )
}

function StreamingIntentSheet({
  draft,
  insets,
  onCancel,
  onChoose,
}: {
  draft: { content: string; attachments: Attachment[] }
  insets: ReturnType<typeof useSafeAreaInsets>
  onCancel: () => void
  onChoose: (intent: StreamingInputIntent) => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const preview = previewPendingText(draft.content, draft.attachments, t)
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: Math.max(insets.bottom, 10) + 106, zIndex: 55, paddingHorizontal: 14 }}>
      <IsleSheet>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 14, fontWeight: '900' }}>{t('chat.responseStillGenerating')}</Text>
              <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 2, fontWeight: '700' }}>
                {preview}
              </Text>
            </View>
            <IslePressable
              haptic
              onPress={onCancel}
              accessibilityLabel={t('chat.cancelStreamingIntent')}
              style={{ width: 44, height: 44, borderRadius: colors.ui.radius.controlLarge, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.material.paperRaised, borderWidth: 1, borderColor: colors.border }}
            >
              <X color={colors.textTertiary} size={16} strokeWidth={2.1} />
            </IslePressable>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 11 }}>
            <IntentAction label={t('chat.intentGuide')} description={t('chat.intentGuideDescription')} onPress={() => onChoose('guide')}>
              <GitBranchPlus color={colors.primary} size={16} strokeWidth={2.1} />
            </IntentAction>
            <IntentAction label={t('chat.intentQueue')} description={t('chat.intentQueueDescription')} onPress={() => onChoose('queue')}>
              <ListEnd color={colors.primary} size={16} strokeWidth={2.1} />
            </IntentAction>
            <IntentAction label={t('chat.intentInterrupt')} description={t('chat.intentInterruptDescription')} danger onPress={() => onChoose('interrupt')}>
              <Split color={colors.error} size={16} strokeWidth={2.1} />
            </IntentAction>
          </View>
      </IsleSheet>
    </View>
  )
}

function IntentAction({
  label,
  description,
  danger = false,
  children,
  onPress,
}: {
  label: string
  description: string
  danger?: boolean
  children: ReactNode
  onPress: () => void
}) {
  const { colors } = useAppTheme()
  const actionRadius = colors.ui.radius.field
  return (
    <IslePressable
      haptic
      onPress={onPress}
      accessibilityLabel={label}
      style={{
        flex: 1,
        minHeight: 60,
        borderRadius: actionRadius,
        paddingHorizontal: 10,
        paddingVertical: 9,
        backgroundColor: danger ? colors.coralWash : colors.material.paperRaised,
        borderWidth: 1,
        borderColor: danger ? colors.error : colors.border,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {children}
        <Text style={{ color: danger ? colors.error : colors.text, fontSize: 13, fontWeight: '900' }}>{label}</Text>
      </View>
      <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '800', marginTop: 4 }}>
        {description}
      </Text>
    </IslePressable>
  )
}

function renderConversationHeaderSpacer(
  providerHealth: ConversationHealth | null,
  colors: ReturnType<typeof useAppTheme>['colors'],
  t: TFunction
) {
  return (
    <View style={{ gap: 8, marginBottom: 4 }}>
      {providerHealth?.code ? (
        <Text style={{ color: providerHealth.inheritedExpired ? colors.error : colors.warning, fontSize: 11, fontWeight: '800' }}>
          {providerHealth.inheritedExpired ? t('chat.inheritedConfigExpired') : t('chat.conversationConfigIssue')}
        </Text>
      ) : null}
    </View>
  )
}

function SetupEmptyState({ description, actionLabel, glyph, onAction }: { description: string; actionLabel: string; glyph: NavigationGlyph; onAction: () => void }) {
  const { colors } = useAppTheme()
  const navigation = useNavigationTrigger(onAction)
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: '100%', maxWidth: 330, alignItems: 'center', gap: 14 }}>
        <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 21, fontWeight: '800', textAlign: 'center' }}>
          {description}
        </Text>
        <IslePressable
          haptic
          onPress={navigation.trigger}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={{ minHeight: 48, minWidth: 148, borderRadius: colors.ui.radius.controlLarge, paddingHorizontal: 18, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.control.primaryBackground, borderWidth: 1, borderColor: colors.ui.control.primaryBorder, shadowColor: colors.ui.control.shadow, shadowOpacity: colors.ui.control.primaryShadowOpacity, shadowRadius: colors.ui.control.primaryShadowRadius, shadowOffset: { width: 0, height: colors.ui.control.primaryShadowOffset } }}
        >
          <AnimatedNavigationIcon glyph={glyph} active={navigation.active} color={colors.ui.control.primaryForeground} size={18} />
          <Text style={{ color: colors.ui.control.primaryForeground, fontSize: 14, fontWeight: '900' }}>{actionLabel}</Text>
        </IslePressable>
      </View>
    </View>
  )
}

function EmptyConversationState({ onHistory, onProviders, topPadding }: { onHistory: () => void; onProviders: () => void; topPadding: number }) {
  const { t } = useTranslation()
  return (
    <View style={{ paddingTop: topPadding, gap: 14 }}>
      <IsleEmptyState
        title={t('chat.newConversation')}
      />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <QuickStartAction label={t('chat.configureProviders')} glyph="provider-key" onPress={onProviders} />
        <QuickStartAction label={t('conversation.title')} glyph="history" onPress={onHistory} muted />
      </View>
    </View>
  )
}

function pushSettingsRoute(pathname: '/settings/providers' | '/settings/knowledge', params?: Record<string, string>) {
  const defer = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (callback: (timestamp: number) => void) => setTimeout(() => callback(Date.now()), 0)
  defer(() => {
    router.push(params ? { pathname, params } : { pathname })
  })
}

function buildComposerCommands({
  skills,
  t,
  onOpenKnowledge,
  onOpenModelPicker,
  onApplySkill,
  onCreateDefaultSkill,
}: {
  skills: SkillDefinition[]
  t: TFunction
  onOpenKnowledge: () => void
  onOpenModelPicker: () => void
  onApplySkill: (skill: SkillDefinition) => void
  onCreateDefaultSkill: () => void
}): ComposerCommand[] {
  const skillCommands = skills.slice(0, 8).map((skill) => ({
    id: `skill-${skill.id}`,
    label: t('skills.switchSkill', { name: skill.name }),
    description: skill.description || skill.tags.join(', ') || t('skills.applyDescription'),
    run: () => onApplySkill(skill),
  }))
  return [
    { id: 'model-picker', label: t('chat.commandSwitchModel'), description: t('chat.commandSwitchModelDescription'), run: onOpenModelPicker },
    { id: 'knowledge-import', label: t('chat.importKnowledge'), description: t('chat.commandKnowledgeDescription'), run: onOpenKnowledge },
    ...skillCommands,
    ...(skills.length ? [] : [{ id: 'create-skill', label: t('skills.createDefault'), description: t('skills.createDefaultDescription'), run: onCreateDefaultSkill }]),
  ]
}

function buildComposerReferences({
  providers,
  skills,
  knowledgeDocuments,
  memoryItems,
  settings,
}: {
  providers: AIProvider[]
  skills: SkillDefinition[]
  knowledgeDocuments: KnowledgeDocument[]
  memoryItems: MemoryItem[]
  settings: ReturnType<typeof useSettingsStore.getState>['settings']
}): CommandReference[] {
  const cleanedProviders = providers.filter((provider) => provider.id !== 'local-setup' && !hasOnlyHistoricalDefaultModels(provider) && providerHasPolicyAllowedModel(provider, settings))
  const providerRefs = cleanedProviders.map((provider) => ({
    id: provider.id,
    type: 'provider' as const,
    label: provider.name,
    value: provider.baseUrl ?? provider.id,
    metadata: { enabled: provider.enabled },
  }))
  const modelRefs = cleanedProviders.flatMap((provider) =>
    getPolicyAllowedProviderModels(provider, settings).slice(0, 12).map((model) => ({
      id: `${provider.id}:${model}`,
      type: 'model' as const,
      label: getProviderDisplayModel(provider, model),
      value: model,
      metadata: { providerId: provider.id, providerName: provider.name },
    }))
  )
  const skillRefs = skills.map((skill) => ({
    id: skill.id,
    type: 'skill' as const,
    label: skill.name,
    value: skill.systemPrompt.slice(0, 120),
    metadata: { layer: skill.layer, tags: skill.tags },
  }))
  const knowledgeRefs = knowledgeDocuments.slice(0, 20).map((document) => ({
    id: document.id,
    type: 'knowledge' as const,
    label: document.title,
    value: document.sourceUri ?? document.id,
    metadata: { chunkCount: document.chunkCount },
  }))
  const memoryRefs = memoryItems.slice(0, 20).map((memory) => ({
    id: memory.id,
    type: 'memory' as const,
    label: memory.content.slice(0, 36),
    value: memory.content,
    metadata: { status: memory.status },
  }))
  return [...providerRefs, ...modelRefs, ...skillRefs, ...knowledgeRefs, ...memoryRefs]
}

function hasOnlyHistoricalDefaultModels(provider: AIProvider): boolean {
  const models = provider.models.map((model) => model.trim().toLowerCase()).filter(Boolean)
  if (!models.length) return false
  if (hasRemoteProviderModelEvidence(provider)) return false
  const defaults = new Set(['deepseek-v4-pro', 'deepseek-v4-flash'])
  return models.every((model) => defaults.has(model))
}

function optionsPanelOverlayStyle(placement: ChatOptionsPlacement, topInset: number, bottomInset: number): ViewStyle {
  if (placement === 'sheet') {
    return {
      position: 'absolute',
      left: 12,
      right: 12,
      bottom: Math.max(12, bottomInset + 8),
      zIndex: 72,
    }
  }
  return {
    position: 'absolute',
    left: 12,
    right: 12,
    top: Math.max(62, topInset + 70),
    zIndex: 72,
  }
}

function buildModelQuickOptions(providers: AIProvider[], settings?: ReturnType<typeof useSettingsStore.getState>['settings']): ModelQuickOption[] {
  return providers.flatMap((provider) =>
    getPolicyAllowedProviderModels(provider, settings).map((model) => ({
      id: `${provider.id}:${model}`,
      provider,
      model,
      family: inferModelFamily(provider, model),
    }))
  )
}

function pickReadyProviderForNewConversation(providers: AIProvider[], defaultProvider: string | null | undefined, settings?: ReturnType<typeof useSettingsStore.getState>['settings']): AIProvider | null {
  const enabled = providers.filter((provider) => isProviderConversationReady(provider) && providerHasPolicyAllowedModel(provider, settings))
  return enabled.find((provider) => provider.id === defaultProvider) ?? enabled[0] ?? null
}

function getPolicyAllowedProviderModels(provider: AIProvider, settings?: ReturnType<typeof useSettingsStore.getState>['settings']): string[] {
  return getAccessAllowedProviderModels(provider, settings)
}

function getPolicyPreferredProviderModel(provider: AIProvider, settings?: ReturnType<typeof useSettingsStore.getState>['settings']): string | undefined {
  return getAccessPreferredProviderModel(provider, settings)
}

function providerHasPolicyAllowedModel(provider: AIProvider, settings?: ReturnType<typeof useSettingsStore.getState>['settings']): boolean {
  return accessProviderHasPolicyAllowedModel(provider, settings)
}

function createSetupConversationShell(
  provider: AIProvider | null,
  model: string,
  reasoningEffort: NonNullable<Conversation['reasoningEffort']>,
  systemPrompt: string,
  temperature: number
): Conversation {
  const config = getModelConfig(model, provider?.type, provider?.modelConfigs)
  return {
    id: '__setup__',
    title: '',
    providerId: provider?.id ?? 'setup',
    model,
    providerModelMode: 'inherited',
    systemPrompt,
    temperature,
    topP: 1,
    reasoningEffort,
    maxTokens: config.defaultMaxTokens,
    messages: [],
    createdAt: 0,
    updatedAt: 0,
  }
}

function resolveRuntimeTarget(
  conversation: Conversation | null,
  providers: AIProvider[],
  _defaultProvider: string | null | undefined,
  settings?: ReturnType<typeof useSettingsStore.getState>['settings']
): { conversation: Conversation; provider?: AIProvider } | null {
  if (!conversation) return null
  if (conversation.providerId === 'local-setup') return { conversation }
  const currentProvider = providers.find((item) => item.id === conversation.providerId)
  const currentModelValid = !!currentProvider && getPolicyAllowedProviderModels(currentProvider, settings).includes(conversation.model)
  if ((conversation.providerModelMode ?? 'inherited') === 'manual' && currentProvider && currentModelValid) {
    return { conversation, provider: currentProvider }
  }
  if (currentProvider && currentProvider.enabled && currentModelValid) {
    return { conversation, provider: currentProvider }
  }
  return { conversation, provider: currentProvider }
}

function collectSkillVariableDefaults(skills: SkillDefinition[]): Record<string, string | number | boolean> {
  const values: Record<string, string | number | boolean> = {}
  for (const skill of skills) {
    for (const variable of skill.variables ?? []) {
      if (variable.defaultValue !== undefined) {
        values[variable.name] = variable.defaultValue
      }
    }
  }
  return values
}

function SkillVariableDialogBody({ variableNames, initialValues, onChange }: { variableNames: string[]; initialValues: Record<string, string>; onChange: (values: Record<string, string>) => void }) {
  const [values, setValues] = useState(initialValues)

  function updateValue(name: string, value: string) {
    setValues((current) => {
      const next = { ...current, [name]: value }
      onChange(next)
      return next
    })
  }

  return (
    <View style={{ gap: 10 }}>
      {variableNames.map((name) => (
        <IsleField
          key={name}
          label={name}
          inputProps={{
            value: values[name] ?? '',
            onChangeText: (value) => updateValue(name, value),
            autoCapitalize: 'none',
            autoCorrect: false,
            placeholder: name,
          }}
        />
      ))}
    </View>
  )
}

function QuickStartAction({ label, glyph, muted = false, onPress }: { label: string; glyph: NavigationGlyph; muted?: boolean; onPress: () => void }) {
  const { colors } = useAppTheme()
  const backgroundColor = muted ? colors.material.paperRaised : colors.ui.control.primaryBackground
  const foregroundColor = muted ? colors.textSecondary : colors.ui.control.primaryForeground
  const borderColor = muted ? colors.border : colors.ui.control.primaryBorder
  const navigation = useNavigationTrigger(onPress)
  return (
    <IslePressable
      haptic
      onPress={navigation.trigger}
      style={{
        minHeight: 44,
        borderRadius: colors.ui.radius.chip,
        paddingHorizontal: 15,
        flexDirection: 'row',
        gap: 6,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor,
        borderWidth: muted ? 1 : 0,
        borderColor,
      }}
    >
      <AnimatedNavigationIcon glyph={glyph} active={navigation.active} color={foregroundColor} size={16} />
      <Text style={{ color: foregroundColor, fontSize: 12, fontWeight: '900' }}>{label}</Text>
    </IslePressable>
  )
}

function getMessageActivityLabel(message: Message, t: TFunction): string {
  const traces = collectMessageTraces(message)
  return getActiveTraceTitle(traces, message.status) || messageActivityStatusLabel(message, t)
}

function messageActivityStatusLabel(message: Message, t: TFunction): string {
  switch (message.status) {
    case 'sending':
      return t('chat.statusPreparing')
    case 'streaming':
      return t('chat.generating')
    case 'error':
      return t('messageBubble.failed')
    case 'cancelled':
      return t('messageBubble.stopped')
    case 'done':
      return t('common.done')
  }
}

function previewPendingText(content: string, attachments: Attachment[], t: TFunction): string {
  const text = content.trim().replace(/\s+/g, ' ')
  const label = text ? (text.length > 24 ? `${text.slice(0, 24)}...` : text) : t('chat.attachmentMessage')
  return attachments.length ? `${label} · ${t('chat.attachmentCount', { count: attachments.length })}` : label
}

interface ConversationHealth {
  code: ChatErrorCode | ProviderOperationCode | 'provider_missing' | null
  title: string
  description: string
  inheritedExpired: boolean
  providerId?: string
}

async function resolveConversationHealth(
  conversation: Conversation | null,
  providers: AIProvider[],
  hydrateProviderKey: (id: string) => Promise<AIProvider | null>,
  t: TFunction,
  settings?: ReturnType<typeof useSettingsStore.getState>['settings']
): Promise<ConversationHealth | null> {
  if (!conversation || conversation.providerId === 'local-setup') return null
  const provider = providers.find((item) => item.id === conversation.providerId)
  const inheritedExpired = false
  if (!provider) {
    return {
      code: 'provider_missing',
      title: inheritedExpired ? t('chat.providerInheritedMissing') : t('chat.providerMissing'),
      description: t('chat.providerMissingDescription', { providerId: conversation.providerId }),
      inheritedExpired,
      providerId: conversation.providerId,
    }
  }
  if (!provider.enabled) {
    return health('disabled_provider', inheritedExpired, provider.id, provider.name, t('chat.providerDisabledDescription'), t)
  }
  const upstreamModel = resolveProviderModelAlias(provider, conversation.model)
  const access = resolveProviderModelAliasAccess({ provider, model: conversation.model, settings })
  if (!access.allowed) {
    return health('model_unavailable', inheritedExpired, provider.id, provider.name, t('chat.modelNotInProvider', { model: conversation.model, provider: provider.name }), t)
  }
  const availableModels = getPolicyAllowedProviderModels(provider, settings)
  if (!availableModels.includes(conversation.model)) {
    return health('model_unavailable', inheritedExpired, provider.id, provider.name, t('chat.modelNotInProvider', { model: conversation.model, provider: provider.name }), t)
  }
  const keyedProvider = await hydrateProviderKey(provider.id)
  if (!keyedProvider?.apiKey.trim()) {
    return health('missing_key', inheritedExpired, provider.id, provider.name, t('chat.providerMissingKey'), t)
  }
  const issue = getProviderConfigIssue(keyedProvider, keyedProvider.apiKey)
  if (issue) {
    return health(issue.code, inheritedExpired, provider.id, provider.name, t(issue.messageKey ?? issue.message, { defaultValue: issue.message }), t)
  }
  if (provider.lastTestStatus === 'bad' && provider.lastTestCode && provider.lastTestCode !== 'ok' && (!provider.lastTestModel || provider.lastTestModel === conversation.model || provider.lastTestModel === upstreamModel)) {
    return health(provider.lastTestCode, inheritedExpired, provider.id, provider.name, provider.lastTestMessage || t('chat.lastTestFailed'), t)
  }
  if (provider.lastTestStatus !== 'ok') {
    return health('model_unavailable', inheritedExpired, provider.id, provider.name, t('chat.providerEnabledNeedsCheck'), t)
  }
  const config = getModelConfig(upstreamModel, provider.type, provider.modelConfigs)
  if (config.deprecated) {
    return health('model_unavailable', inheritedExpired, provider.id, provider.name, t('chat.modelDeprecated', { model: getProviderDisplayModel(provider, conversation.model) }), t)
  }
  return { code: null, title: '', description: '', inheritedExpired, providerId: provider.id }
}

function health(
  code: ConversationHealth['code'],
  inheritedExpired: boolean,
  providerId: string,
  providerName: string,
  description: string,
  t: TFunction
): ConversationHealth {
  return {
    code,
    title: inheritedExpired ? t('chat.inheritedConfigExpired') : t('chat.conversationConfigIssue'),
    description: `${providerName}: ${description}`,
    inheritedExpired,
    providerId,
  }
}

function ConversationHealthBanner({
  health,
  testing,
  onConfigure,
  onTest,
  onSwitch,
  compact = false,
}: {
  health: ConversationHealth
  testing: boolean
  onConfigure: () => void
  onTest: () => void
  onSwitch: () => void
  compact?: boolean
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const borderColor = health.inheritedExpired ? colors.error : colors.warning
  return (
    <MotiView
      from={{ opacity: 0, translateY: -8, scale: 0.98 }}
      animate={{ opacity: 1, translateY: 0, scale: 1 }}
      transition={{ type: 'spring', damping: 20, stiffness: 180 }}
      style={{
        marginHorizontal: compact ? 0 : 16,
        marginBottom: 8,
        borderRadius: compact ? colors.ui.radius.field : colors.ui.radius.card,
        padding: compact ? 10 : 13,
        backgroundColor: colors.material.paperRaised,
        borderWidth: 1,
        borderColor,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ width: compact ? 28 : 34, height: compact ? 28 : 34, borderRadius: colors.ui.radius.controlMiddle, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.material.field }}>
          <AlertTriangle color={borderColor} size={compact ? 15 : 18} strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: compact ? 13 : 14, fontWeight: '900' }}>{health.title}</Text>
          {!compact ? <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 3 }}>{health.description}</Text> : null}
          {health.inheritedExpired && !compact ? (
            <Text style={{ color: colors.error, fontSize: 11, lineHeight: 16, marginTop: 5 }}>
              {t('chat.chooseAvailableModel')}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: compact ? 8 : 10 }}>
        <BannerAction label={t('chat.configure')} glyph="provider-key" onPress={onConfigure} compact={compact} />
        <BannerAction
          label={testing ? t('chat.testing') : compact ? t('chat.test') : t('chat.testCurrentModel')}
          onPress={onTest}
          compact={compact}
          disabled={testing || health.code === 'missing_key' || health.code === 'disabled_provider' || health.code === 'provider_missing'}
        />
        <BannerAction label={compact ? t('chat.switch') : t('chat.switchModel')} onPress={onSwitch} compact={compact} />
      </View>
    </MotiView>
  )
}

function BannerAction({ label, glyph, compact = false, disabled = false, onPress }: { label: string; glyph?: NavigationGlyph; compact?: boolean; disabled?: boolean; onPress: () => void }) {
  const { colors } = useAppTheme()
  const navigation = useNavigationTrigger(onPress)
  const press = glyph ? navigation.trigger : onPress
  return (
    <IslePressable
      haptic
      disabled={disabled}
      onPress={press}
      style={{
        minHeight: 44,
        borderRadius: colors.ui.radius.chip,
        paddingHorizontal: compact ? 12 : 14,
        flexDirection: 'row',
        gap: glyph ? 6 : 0,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.material.paperRaised,
        borderWidth: 1,
        borderColor: colors.border,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {glyph ? <AnimatedNavigationIcon glyph={glyph} active={navigation.active} color={colors.text} size={16} /> : null}
      <Text style={{ color: colors.text, fontSize: compact ? 11 : 12, fontWeight: '800' }}>{label}</Text>
    </IslePressable>
  )
}

function formatTokenLimit(value: number): string {
  if (value >= 1000000) return `${Math.round(value / 100000) / 10}M`
  if (value >= 1000) return `${Math.round(value / 1000)}K`
  return String(value)
}

function formatModelContextLimit(config: ReturnType<typeof getModelConfig>, t: TFunction): string {
  const value = formatTokenLimit(config.contextWindow)
  return config.source === 'inferred' ? t('chat.contextUnknownSafeBudget', { value }) : value
}

function formatHeaderMeta(conversation: Conversation, provider: AIProvider | undefined, metrics: ConversationMetrics, t: TFunction): string {
  if (conversation.providerId === 'local-setup') return t('chat.localNoNetwork')
  const upstreamModel = provider ? resolveProviderModelAlias(provider, conversation.model) : conversation.model
  const config = getModelConfig(upstreamModel, provider?.type, provider?.modelConfigs)
  const parts = [
    t('chat.contextMeta', { value: formatModelContextLimit(config, t) }),
    t('chat.outputMeta', { value: formatTokenLimit(conversation.maxTokens || config.defaultMaxTokens) }),
    metrics.totalTokens ? t('chat.conversationTokenMeta', { value: formatTokenLimit(metrics.totalTokens), estimated: metrics.estimated ? ` ${t('chat.estimated')}` : '' }) : '',
    metrics.durationMs ? t('chat.durationMeta', { value: formatDuration(metrics.durationMs) }) : '',
  ].filter(Boolean)
  return parts.join(' · ')
}

function getProviderHeaderState(
  conversation: Conversation,
  provider: AIProvider | undefined,
  providers: AIProvider[],
  metrics: ConversationMetrics,
  providerHealth: ConversationHealth | null,
  settings: ReturnType<typeof useSettingsStore.getState>['settings'],
  t: TFunction
): { title: string; subtitle?: string } {
  const enabledProviders = providers.filter((item) => item.id !== 'local-setup' && item.enabled)
  const modelCapableProviders = enabledProviders.filter((item) => providerHasPolicyAllowedModel(item, settings))
  const hasEnabledProvider = enabledProviders.length > 0
  const hasAvailableModel = modelCapableProviders.length > 0
  if (!hasEnabledProvider) return { title: t('chat.noProviderConnected') }
  if (!hasAvailableModel) return { title: t('chat.noAvailableModels') }
  if (conversation.providerId === 'local-setup') {
    const fallbackProvider = modelCapableProviders.find((item) => isProviderConversationReady(item)) ?? modelCapableProviders[0]
    const fallbackModel = fallbackProvider ? getPolicyPreferredProviderModel(fallbackProvider, settings) : undefined
    return {
      title: fallbackProvider?.name ?? t('settings.providerManagement'),
      subtitle: fallbackProvider && fallbackModel ? getProviderDisplayModel(fallbackProvider, fallbackModel) : undefined,
    }
  }
  const modelLabel = getProviderDisplayModel(provider, conversation.model)
  return {
    title: provider?.name ?? t('settings.providerManagement'),
    subtitle: providerHealth?.code
      ? `${providerHealth.title} · ${modelLabel}`
      : provider?.enabled && provider.lastTestStatus !== 'ok'
        ? `${t('chat.providerEnabledNeedsCheck')} · ${modelLabel}`
      : `${modelLabel} · ${formatHeaderMeta(conversation, provider, metrics, t)}`,
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`
  return `${Math.round(ms / 60000)}m`
}
