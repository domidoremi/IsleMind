import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import {
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewStyle,
} from 'react-native'
import { FlashList, type FlashListRef } from '@shopify/flash-list'
import * as Clipboard from 'expo-clipboard'
import * as Linking from 'expo-linking'
import { router } from 'expo-router'
import { AlertTriangle, BookOpen, ChevronLeft, GitBranchPlus, History, KeyRound, ListEnd, Settings2, Split, X } from 'lucide-react-native'
import { MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import { Screen } from '@/components/ui/Screen'
import { PressableScale } from '@/components/ui/PressableScale'
import { IslandField, IslandHeader, IslandIconButton, IslandListItem, IslandSheet } from '@/components/ui/IslandPrimitives'
import { useIslandDialog } from '@/components/ui/IslandDialog'
import { Composer } from '@/components/chat/Composer'
import type { ComposerCommand } from '@/components/chat/Composer'
import { ChatOptionsPanel } from '@/components/chat/ChatOptionsPanel'
import { MessageBubble } from '@/components/chat/MessageBubble'
import { EmptyState } from '@/components/ui/EmptyState'
import { copyMessageFinalText, recoverStaleStreamingMessages, regenerateLastAssistant, retryMessage, sendMessage, stopMessage } from '@/services/chatRunner'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { testProviderModelDetailed } from '@/services/ai/base'
import { localDataStore } from '@/services/localDataStore'
import { getModelConfig, getModelName, getProviderConfigIssue } from '@/types'
import { speakText } from '@/services/speech'
import type { AIProvider, Attachment, ChatErrorCode, Conversation, Message, ProviderOperationCode } from '@/types'
import type { CommandReference, KnowledgeDocument, MemoryItem, SkillDefinition } from '@/types'
import { collectMessageTraces, getActiveTraceTitle } from './tracePresentation'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useMainPagerGestureLock } from '@/components/main/MainPagerGestureLock'
import { applySkillStack, createBaseSkill, extractSkillVariables, listSkills, upsertSkill } from '@/services/skills'
import { listKnowledgeDocuments, listMemories } from '@/services/contextStore'

type StreamingInputIntent = 'guide' | 'queue' | 'interrupt'

const CHAT_TOP_FLOATING_SPACE = 112
const CHAT_BOTTOM_FLOATING_SPACE = 132

interface PendingStreamingMessage {
  intent: Exclude<StreamingInputIntent, 'interrupt'>
  content: string
  attachments: Attachment[]
}

interface ChatWorkspaceProps {
  conversation: Conversation | null
  showBack?: boolean
  embedded?: boolean
  onHistory?: () => void
  onSettings?: () => void
}

export function ChatWorkspace({ conversation, showBack = false, embedded = false, onHistory, onSettings }: ChatWorkspaceProps) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIslandDialog()
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
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
  const lastScrollOffset = useRef(0)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastAutoScrollAt = useRef(0)
  const enabledProviders = useMemo(() => providers.filter((item) => item.id !== 'local-setup' && item.enabled), [providers])
  const hasEnabledProvider = enabledProviders.length > 0
  const hasAvailableModel = enabledProviders.some((item) => item.models.length > 0)
  const homeProvider = pickReadyProviderForNewConversation(providers, settings.defaultProvider)
  const runtimeTarget = resolveRuntimeTarget(conversation, providers, settings.defaultProvider)
  const runtimeConversation = runtimeTarget?.conversation ?? conversation
  const provider = runtimeTarget?.provider
  const reasoningEffort = runtimeConversation?.reasoningEffort ?? 'medium'
  const supportsReasoningQuick = !!provider && providerSupportsReasoning(provider, runtimeConversation?.model)
  const emptyHeaderTitle = !hasEnabledProvider ? t('chat.noProviderConnected') : hasAvailableModel ? homeProvider?.name ?? t('settings.providerManagement') : t('chat.noAvailableModels')
  const emptyHeaderSubtitle = homeProvider?.models[0] ? getModelName(homeProvider.models[0]) : undefined
  const providerHealthKey = useMemo(() => provider ? [
    provider.id,
    provider.enabled ? 'on' : 'off',
    provider.models.join(','),
    provider.baseUrl ?? '',
    provider.credentialMode ?? '',
    provider.tokenPlanRegion ?? '',
    provider.wireProtocol ?? '',
    provider.lastTestStatus ?? '',
    provider.lastTestCode ?? '',
    provider.lastTestModel ?? '',
    provider.lastTestMessage ?? '',
  ].join('|') : runtimeConversation?.providerId ?? 'none', [runtimeConversation?.providerId, provider])
  const switchableProviders = useMemo(
    () => providers.filter((item) => item.id !== 'local-setup'),
    [providers]
  )
  const metrics = useMemo(() => localDataStore.getConversationMetrics(runtimeConversation), [runtimeConversation])
  const streamingMessage = runtimeConversation?.messages.find((message) => message.status === 'streaming')
  const isStreaming = !!streamingMessage
  const lastMessage = runtimeConversation?.messages.at(-1)
  const regenerableAssistantId = lastMessage?.role === 'assistant' ? lastMessage.id : undefined
  const messageSignature = runtimeConversation?.messages.map((message) => `${message.id}:${message.content.length}:${message.status}`).join('|')
  const activityLabel = streamingMessage ? getMessageActivityLabel(streamingMessage, t) : ''
  const optionsPanelHeight = Math.min(windowHeight * 0.52, 344)
  const listTopInset = Math.max(CHAT_TOP_FLOATING_SPACE, insets.top + 92)
  const composerBottomInset = Math.max(insets.bottom, 10) + CHAT_BOTTOM_FLOATING_SPACE
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
    }),
    [knowledgeDocuments, memoryItems, providers, skills]
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

  async function applySkillToActiveConversation(nextSkills: SkillDefinition[]) {
    if (!nextSkills.length || !runtimeConversation) return
    const variableValues = await collectSkillVariableValues(nextSkills)
    if (!variableValues) return
    const result = applySkillStack({ conversation: runtimeConversation, skills: nextSkills, variables: variableValues })
    updateConversation(runtimeConversation.id, result.conversationUpdates)
    if (result.snapshot.providerId && result.snapshot.model) {
      switchConversationModel(runtimeConversation.id, result.snapshot.providerId, result.snapshot.model)
    }
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

  const ScreenWrapper = embedded ? View : Screen
  const screenProps = embedded ? { style: { flex: 1 } } : { padded: false }

  useEffect(() => {
    const now = Date.now()
    const wait = Math.max(40, 140 - (now - lastAutoScrollAt.current))
    if (autoScrollTimer.current) clearTimeout(autoScrollTimer.current)
    autoScrollTimer.current = setTimeout(() => {
      lastAutoScrollAt.current = Date.now()
      listRef.current?.scrollToEnd({ animated: true })
    }, wait)
    return () => {
      if (autoScrollTimer.current) clearTimeout(autoScrollTimer.current)
    }
  }, [messageSignature])

  useEffect(() => {
    let mounted = true
    void resolveConversationHealth(runtimeConversation, providers, hydrateProviderKey, t).then((health) => {
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
    recoverStaleStreamingMessages(conversation.id)
  }, [conversation?.id])

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
    setPagerGestureLocked?.(showOptions)
    return () => setPagerGestureLocked?.(false)
  }, [setPagerGestureLocked, showOptions])

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
      const readyProvider = pickReadyProviderForNewConversation(useSettingsStore.getState().providers, useSettingsStore.getState().settings.defaultProvider)
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
      const id = createConversation(readyProvider.id, readyProvider.models[0])
      const nextConversation = useChatStore.getState().conversations.find((item) => item.id === id)
      if (nextConversation) {
        try {
          await sendMessage({ conversation: nextConversation, content, attachments })
        } catch (error) {
          dialog.toast({ title: t('chat.sendFailed'), message: error instanceof Error ? error.message : t('chat.sendFailedMessage'), tone: 'danger' })
        }
      }
    }

    return (
      <ScreenWrapper {...screenProps}>
        <View style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <PressableScale
              onPress={goHistory}
              accessibilityLabel={t('conversation.title')}
              style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: colors.islandRaised, borderWidth: 1, borderColor: colors.border }}
            >
              <History color={colors.text} size={18} strokeWidth={1.8} />
            </PressableScale>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>{emptyHeaderTitle}</Text>
              {emptyHeaderSubtitle ? (
                <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                  {emptyHeaderSubtitle}
                </Text>
              ) : null}
            </View>
            <PressableScale
              haptic
              onPress={goSettings}
              accessibilityLabel={t('settings.title')}
              style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: colors.text }}
            >
              <Settings2 color={colors.surface} size={18} strokeWidth={1.9} />
            </PressableScale>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 10) + CHAT_BOTTOM_FLOATING_SPACE }}>
            <EmptyState
              title={emptyHeaderTitle}
              actionLabel={hasAvailableModel ? t('chat.startChat') : t('chat.configureProviders')}
              onAction={hasAvailableModel ? () => {
                const readyProvider = pickReadyProviderForNewConversation(useSettingsStore.getState().providers, useSettingsStore.getState().settings.defaultProvider)
                if (readyProvider) createConversation(readyProvider.id, readyProvider.models[0])
              } : goProviders}
            />
            {!hasAvailableModel ? <View style={{ gap: 10, marginTop: 18 }}>
              <OnboardingCard
                icon={<KeyRound color={colors.text} size={18} />}
                title={t('chat.configureProviders')}
                onPress={goProviders}
              />
              <OnboardingCard
                icon={<BookOpen color={colors.text} size={18} />}
                title={t('chat.importKnowledge')}
                onPress={goKnowledge}
              />
            </View> : null}
          </ScrollView>
          <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14, paddingBottom: 12, paddingTop: 4 }}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
              <Composer
                streaming={false}
                commands={composerCommands}
                references={composerReferences}
                onStop={() => undefined}
                onReferenceSelected={() => undefined}
                onSend={submitSetup}
              />
            </KeyboardAvoidingView>
          </View>
        </View>
      </ScreenWrapper>
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
      intentDraft={intentDraft}
      composerCommands={composerCommands}
      composerReferences={composerReferences}
      supportsReasoningQuick={supportsReasoningQuick}
      reasoningEffort={reasoningEffort}
      metrics={metrics}
      regenerableAssistantId={regenerableAssistantId}
      switchableProviders={switchableProviders}
      optionsPanelHeight={optionsPanelHeight}
      listTopInset={listTopInset}
      composerBottomInset={composerBottomInset}
      insets={insets}
      colors={colors}
      screenProps={screenProps}
      ScreenWrapper={ScreenWrapper}
      showBack={showBack}
      goHistory={goHistory}
      goSettings={goSettings}
      goProviders={goProviders}
      goKnowledge={goKnowledge}
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
      markChromeActive={markChromeActive}
      scheduleChromeIdleCollapse={scheduleChromeIdleCollapse}
      lastScrollOffset={lastScrollOffset}
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
  intentDraft,
  composerCommands,
  composerReferences,
  supportsReasoningQuick,
  reasoningEffort,
  metrics,
  regenerableAssistantId,
  switchableProviders,
  optionsPanelHeight,
  listTopInset,
  composerBottomInset,
  insets,
  colors,
  screenProps,
  ScreenWrapper,
  showBack,
  goHistory,
  goSettings,
  goProviders,
  goKnowledge,
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
  markChromeActive,
  scheduleChromeIdleCollapse,
  lastScrollOffset,
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
  intentDraft: { content: string; attachments: Attachment[] } | null
  composerCommands: ComposerCommand[]
  composerReferences: CommandReference[]
  supportsReasoningQuick: boolean
  reasoningEffort: NonNullable<Conversation['reasoningEffort']>
  metrics: ReturnType<typeof localDataStore.getConversationMetrics>
  regenerableAssistantId?: string
  switchableProviders: AIProvider[]
  optionsPanelHeight: number
  listTopInset: number
  composerBottomInset: number
  insets: ReturnType<typeof useSafeAreaInsets>
  colors: ReturnType<typeof useAppTheme>['colors']
  screenProps: Record<string, unknown>
  ScreenWrapper: typeof View | typeof Screen
  showBack: boolean
  goHistory: () => void
  goSettings: () => void
  goProviders: () => void
  goKnowledge: () => void
  updateConversation: (id: string, updates: Partial<Conversation>) => void
  switchConversationModel: (id: string, providerId: string, model: string) => void
  removeMessage: (convId: string, msgId: string) => void
  hydrateProviderKey: (id: string) => Promise<AIProvider | null>
  updateProvider: (id: string, updates: Partial<AIProvider>) => Promise<void>
  dialog: ReturnType<typeof useIslandDialog>
  listRef: React.RefObject<FlashListRef<Message> | null>
  setShowOptions: React.Dispatch<React.SetStateAction<boolean>>
  setChromeCollapsed: React.Dispatch<React.SetStateAction<boolean>>
  setPendingStreamingMessage: React.Dispatch<React.SetStateAction<PendingStreamingMessage | null>>
  setIntentDraft: React.Dispatch<React.SetStateAction<{ content: string; attachments: Attachment[] } | null>>
  setProviderHealth: React.Dispatch<React.SetStateAction<ConversationHealth | null>>
  setTestingHeader: React.Dispatch<React.SetStateAction<boolean>>
  markChromeActive: () => void
  scheduleChromeIdleCollapse: () => void
  lastScrollOffset: React.MutableRefObject<number>
}) {
  const { t } = useTranslation()

  async function submit(content: string, attachments: Attachment[]) {
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
    setPendingStreamingMessage({ intent, content: draft.content, attachments: draft.attachments })
  }

  async function testCurrentModel(message: Message) {
    const providerId = message.errorProviderId ?? activeConversation.providerId
    const keyedProvider = await hydrateProviderKey(providerId)
    if (!keyedProvider?.apiKey) {
      goSettings()
      return
    }
    const result = await testProviderModelDetailed(keyedProvider, activeConversation.model, keyedProvider.apiKey)
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
    const result = await testProviderModelDetailed(keyedProvider, activeConversation.model, keyedProvider.apiKey)
    await useSettingsStore.getState().updateProviderCredentialGroupHealth(keyedProvider.id, result.credentialGroupId, result.ok)
    await updateProvider(keyedProvider.id, {
      lastTestStatus: result.ok ? 'ok' : 'bad',
      lastTestedAt: Date.now(),
      lastTestModel: activeConversation.model,
      lastTestMessage: result.message,
      lastTestCode: result.code,
    })
    setProviderHealth(await resolveConversationHealth(activeConversation, useSettingsStore.getState().providers, hydrateProviderKey, t))
    setTestingHeader(false)
    dialog.toast({ title: result.ok ? t('chat.modelAvailable') : t('chat.modelUnavailable'), message: result.ok ? t('chat.modelTestPassed', { model: activeConversation.model }) : result.message, tone: result.ok ? 'mint' : 'danger' })
  }

  function confirmSwitchModel(nextProvider: AIProvider, nextModel: string) {
    if (nextProvider.id === activeConversation.providerId && nextModel === activeConversation.model) return
    void (async () => {
      const nextConfig = getModelConfig(nextModel, nextProvider.type, nextProvider.modelConfigs)
      const currentConfig = getModelConfig(activeConversation.model, provider?.type, provider?.modelConfigs)
      const confirmed = await dialog.confirm({
        title: t('chat.switchModelTitle'),
        message: t('chat.switchModelMessage'),
        tone: 'amber',
        confirmLabel: t('chat.switchModelConfirm'),
        cancelLabel: t('common.cancel'),
        chips: [
          { label: nextProvider.name, tone: 'mint' },
          { label: getModelName(nextModel), tone: 'amber' },
          { label: t('chat.currentConversationOnly'), tone: 'default' },
        ],
        metrics: [
          { label: t('chat.contextWindow'), before: formatTokenLimit(currentConfig.contextWindow), after: formatTokenLimit(nextConfig.contextWindow) },
          { label: t('chat.outputLimit'), before: formatTokenLimit(currentConfig.maxOutputTokens), after: formatTokenLimit(nextConfig.maxOutputTokens) },
        ],
      })
      if (!confirmed) return
      safeStopMessage(activeConversation.id)
      switchConversationModel(activeConversation.id, nextProvider.id, nextModel)
      dialog.toast({ title: t('chat.modelSwitched'), message: `${nextProvider.name} · ${getModelName(nextModel)}`, tone: 'mint' })
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
    if (delta < -10 || y < 18) {
      markChromeActive()
    } else if (Math.abs(delta) > 8) {
      scheduleChromeIdleCollapse()
    }
    lastScrollOffset.current = y
  }

  function closeOptionsFromBackground() {
    if (showOptions) setShowOptions(false)
  }

  return (
    <ScreenWrapper {...screenProps}>
        <View style={{ flex: 1 }}>
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
          />

          <View onTouchStart={closeOptionsFromBackground} style={{ flex: 1, paddingTop: listTopInset, paddingBottom: composerBottomInset }}>
            <FlashList
              ref={listRef}
              style={{ flex: 1 }}
              data={activeConversation.messages}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              onScroll={handleListScroll}
              scrollEventThrottle={16}
              contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 28 }}
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
                  onRetry={(item) => void retryMessage(activeConversation.id, item.id).catch((error) => dialog.toast({ title: t('chat.retryFailed'), message: error instanceof Error ? error.message : t('chat.retryFailedMessage'), tone: 'danger' }))}
                  onRegenerate={() => void regenerateLastAssistant(activeConversation.id).catch((error) => dialog.toast({ title: t('chat.regenerateFailed'), message: error instanceof Error ? error.message : t('chat.regenerateFailedMessage'), tone: 'danger' }))}
                  onSpeak={(item) => void speakText(item.responseText ?? item.content, provider)}
                  onDelete={(item) => removeMessage(activeConversation.id, item.id)}
                  onConfigure={goSettings}
                  onTestModel={(item) => void testCurrentModel(item)}
                />
              )}
              ListEmptyComponent={<EmptyConversationState onHistory={goHistory} onProviders={goProviders} onKnowledge={goKnowledge} />}
            />
          </View>

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
            commands={composerCommands}
            references={composerReferences}
            reasoningEffort={reasoningEffort}
            showReasoning={supportsReasoningQuick}
            onReasoningChange={(effort) => updateConversation(activeConversation.id, { reasoningEffort: effort })}
            onClearPending={() => setPendingStreamingMessage(null)}
            disabled={!provider && activeConversation.providerId !== 'local-setup'}
            onStop={() => safeStopMessage(activeConversation.id)}
            onReferenceSelected={rememberCommandReference}
            onSend={submit}
            onSendWhileStreaming={submitWhileStreaming}
            onInteract={closeOptionsFromBackground}
          />
        </View>
    </ScreenWrapper>
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
  onSettings,
  onTestModel,
  onSwitchModel,
  onCopyLink,
  testingHeader,
  switchableProviders,
  optionsPanelHeight,
}: {
  colors: ReturnType<typeof useAppTheme>['colors']
  insets: ReturnType<typeof useSafeAreaInsets>
  collapsed: boolean
  streaming: boolean
  showOptions: boolean
  conversation: Conversation
  provider: AIProvider | undefined
  providerHealth: ConversationHealth | null
  metrics: ReturnType<typeof localDataStore.getConversationMetrics>
  onBack: () => void
  onRestore: () => void
  onToggleOptions: () => void
  onSettings: () => void
  onTestModel: () => void
  onSwitchModel: (provider: AIProvider, model: string) => void
  onCopyLink: () => void
  testingHeader: boolean
  switchableProviders: AIProvider[]
  optionsPanelHeight: number
}) {
  const { t } = useTranslation()
  const header = getProviderHeaderState(conversation, provider, switchableProviders, metrics, providerHealth, t)
  const modelLabel = conversation.providerId === 'local-setup' ? t('chat.localSetupGuide') : getModelName(conversation.model)
  const shellStyle: StyleProp<ViewStyle> = [
    {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: showOptions ? 70 : 40,
    },
  ]
  return (
    <View pointerEvents="box-none" style={shellStyle}>
      <MotiView
        pointerEvents={collapsed ? 'none' : 'auto'}
        animate={{ opacity: collapsed ? 0 : 1, translateY: collapsed ? -(insets.top + 78) : 0 }}
        transition={{ type: 'timing', duration: collapsed ? 150 : 210 }}
        style={{ paddingTop: 6, paddingHorizontal: 12, paddingBottom: 8, zIndex: 1 }}
      >
        <MotiView
          from={{ opacity: 0, translateY: -8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', damping: 22, stiffness: 190 }}
        >
          <IslandHeader
            title={header.title}
            subtitle={header.subtitle}
            leading={
              <IslandIconButton label={t('common.back')} onPress={onBack}>
                {showOptions ? <ChevronLeft color={colors.text} size={18} strokeWidth={1.9} /> : <History color={colors.text} size={18} strokeWidth={1.8} />}
              </IslandIconButton>
            }
            trailing={
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <IslandIconButton label={t('chat.conversationOptions')} onPress={onToggleOptions} tone={showOptions ? 'amber' : 'default'}>
                  <ListEnd color={colors.textSecondary} size={17} strokeWidth={2} />
                </IslandIconButton>
                <IslandIconButton label={t('settings.title')} onPress={onSettings} tone="ink">
                  <Settings2 color={colors.surface} size={18} strokeWidth={1.9} />
                </IslandIconButton>
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

          {showOptions ? (
            <Pressable onPress={(event) => event.stopPropagation()}>
              <ChatOptionsPanel
                conversation={conversation}
                provider={provider}
                switchableProviders={switchableProviders}
                colors={colors}
                maxHeight={optionsPanelHeight}
                onSwitchModel={onSwitchModel}
                onCopyLink={onCopyLink}
              />
            </Pressable>
          ) : null}
        </MotiView>
      </MotiView>
      {collapsed ? (
        <MotiView
          from={{ opacity: 0, translateY: -8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', damping: 20, stiffness: 180 }}
          style={{ position: 'absolute', top: Math.max(8, insets.top + 2), alignSelf: 'center', zIndex: 8 }}
          pointerEvents="auto"
        >
          <Pressable
            onPress={onRestore}
            accessibilityRole="button"
            accessibilityLabel={t('chat.showTopBar')}
            hitSlop={12}
            style={{ minWidth: streaming ? 128 : 82, height: 34, borderRadius: 17, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.material.chrome, borderWidth: 1, borderColor: colors.border }}
          >
            <Text style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '900' }}>{streaming ? t('chat.generatingShowTopBar') : t('chat.showTopBar')}</Text>
          </Pressable>
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
  commands,
  references,
  reasoningEffort,
  showReasoning,
  onReasoningChange,
  onClearPending,
  disabled,
  onStop,
  onReferenceSelected,
  onSend,
  onSendWhileStreaming,
  onInteract,
}: {
  insets: ReturnType<typeof useSafeAreaInsets>
  streaming: boolean
  activityLabel: string
  pendingNotice?: string
  commands: ComposerCommand[]
  references: CommandReference[]
  reasoningEffort: NonNullable<Conversation['reasoningEffort']>
  showReasoning: boolean
  onReasoningChange: (effort: NonNullable<Conversation['reasoningEffort']>) => void
  onClearPending: () => void
  disabled: boolean
  onStop: () => void
  onReferenceSelected: (reference: CommandReference) => void
  onSend: (content: string, attachments: Attachment[]) => Promise<void> | void
  onSendWhileStreaming: (content: string, attachments: Attachment[]) => Promise<void> | void
  onInteract?: () => void
}) {
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const [reasoningOpen, setReasoningOpen] = useState(false)

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

  const androidKeyboardLift = Platform.OS === 'android' ? keyboardHeight : 0

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: androidKeyboardLift, zIndex: 40 }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0} onTouchStart={onInteract}>
        <View pointerEvents="box-none" style={{ paddingHorizontal: 14, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 10) + 8 }}>
          {showReasoning ? (
            <View style={{ alignItems: 'flex-start', marginBottom: 7 }}>
              <PressableScale
                haptic
                onPress={() => setReasoningOpen((value) => !value)}
                accessibilityLabel={t('chat.reasoning')}
                style={{ minHeight: 30, borderRadius: 15, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.material.chrome, borderWidth: 1, borderColor: colors.border }}
              >
                <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900' }}>
                  {t('chat.reasoningChip', { value: t(`chat.reasoningEffort.${reasoningEffort}`) })}
                </Text>
              </PressableScale>
              {reasoningOpen ? (
                <MotiView
                  from={{ opacity: 0, translateY: 4 }}
                  animate={{ opacity: 1, translateY: 0 }}
                  transition={{ type: 'spring', damping: 20, stiffness: 210 }}
                  style={{ flexDirection: 'row', gap: 7, marginTop: 7, padding: 7, borderRadius: 18, backgroundColor: colors.material.chrome, borderWidth: 1, borderColor: colors.border }}
                >
                  {(['minimal', 'low', 'medium', 'high'] as const).map((effort) => (
                    <PressableScale
                      key={effort}
                      haptic
                      onPress={() => {
                        onReasoningChange(effort)
                        setReasoningOpen(false)
                      }}
                      style={{ minHeight: 28, borderRadius: 14, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: reasoningEffort === effort ? colors.text : colors.islandRaised }}
                    >
                      <Text style={{ color: reasoningEffort === effort ? colors.surface : colors.textSecondary, fontSize: 11, fontWeight: '900' }}>
                        {t(`chat.reasoningEffort.${effort}`)}
                      </Text>
                    </PressableScale>
                  ))}
                </MotiView>
              ) : null}
            </View>
          ) : null}
          <Composer
            disabled={disabled}
            streaming={streaming}
            activityLabel={activityLabel}
            pendingNotice={pendingNotice}
            commands={commands}
            references={references}
            onClearPending={onClearPending}
            onStop={onStop}
            onReferenceSelected={onReferenceSelected}
            onSend={onSend}
            onSendWhileStreaming={onSendWhileStreaming}
          />
        </View>
      </KeyboardAvoidingView>
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
      <IslandSheet>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 14, fontWeight: '900' }}>{t('chat.responseStillGenerating')}</Text>
              <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 2, fontWeight: '700' }}>
                {preview}
              </Text>
            </View>
            <PressableScale
              haptic
              onPress={onCancel}
              accessibilityLabel={t('chat.cancelStreamingIntent')}
              style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.islandRaised }}
            >
              <X color={colors.textTertiary} size={16} strokeWidth={2.1} />
            </PressableScale>
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
      </IslandSheet>
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
  return (
    <PressableScale
      haptic
      onPress={onPress}
      accessibilityLabel={label}
      style={{
        flex: 1,
        minHeight: 60,
        borderRadius: 20,
        paddingHorizontal: 10,
        paddingVertical: 9,
        backgroundColor: danger ? colors.coralWash : colors.islandRaised,
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
    </PressableScale>
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

function EmptyConversationState({ onHistory, onProviders, onKnowledge }: { onHistory: () => void; onProviders: () => void; onKnowledge: () => void }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  return (
    <View style={{ paddingTop: 36, gap: 14 }}>
      <EmptyState
        title={t('chat.newConversation')}
      />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <QuickStartAction label={t('chat.configureProviders')} onPress={onProviders} />
        <QuickStartAction label={t('chat.importKnowledge')} onPress={onKnowledge} muted />
        <QuickStartAction label={t('conversation.title')} onPress={onHistory} muted />
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
    { id: 'prompt-template', label: t('chat.commandPromptTemplate'), description: t('chat.commandPromptTemplateDescription'), insertText: t('chat.promptTemplateInsert') },
    ...skillCommands,
    ...(skills.length ? [] : [{ id: 'create-skill', label: t('skills.createDefault'), description: t('skills.createDefaultDescription'), run: onCreateDefaultSkill }]),
  ]
}

function buildComposerReferences({
  providers,
  skills,
  knowledgeDocuments,
  memoryItems,
}: {
  providers: AIProvider[]
  skills: SkillDefinition[]
  knowledgeDocuments: KnowledgeDocument[]
  memoryItems: MemoryItem[]
}): CommandReference[] {
  const providerRefs = providers.filter((provider) => provider.id !== 'local-setup').map((provider) => ({
    id: provider.id,
    type: 'provider' as const,
    label: provider.name,
    value: provider.baseUrl ?? provider.id,
    metadata: { enabled: provider.enabled },
  }))
  const modelRefs = providers.flatMap((provider) =>
    provider.models.slice(0, 12).map((model) => ({
      id: `${provider.id}:${model}`,
      type: 'model' as const,
      label: getModelName(model),
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

function pickReadyProviderForNewConversation(providers: AIProvider[], defaultProvider: string | null | undefined): AIProvider | null {
  const enabled = providers.filter((provider) => provider.id !== 'local-setup' && provider.enabled && provider.models.length > 0)
  return enabled.find((provider) => provider.id === defaultProvider) ?? enabled[0] ?? null
}

function resolveRuntimeTarget(
  conversation: Conversation | null,
  providers: AIProvider[],
  defaultProvider: string | null | undefined
): { conversation: Conversation; provider?: AIProvider } | null {
  if (!conversation) return null
  if (conversation.providerId === 'local-setup') return { conversation }
  if ((conversation.providerModelMode ?? 'inherited') !== 'inherited') {
    return { conversation, provider: providers.find((item) => item.id === conversation.providerId) }
  }
  const readyProvider = pickReadyProviderForNewConversation(providers, defaultProvider)
  if (!readyProvider?.models[0]) {
    return { conversation, provider: providers.find((item) => item.id === conversation.providerId) }
  }
  const model = readyProvider.models[0]
  const config = getModelConfig(model, readyProvider.type, readyProvider.modelConfigs)
  return {
    provider: readyProvider,
    conversation: {
      ...conversation,
      providerId: readyProvider.id,
      model,
      maxTokens: Math.min(conversation.maxTokens || config.defaultMaxTokens, config.maxOutputTokens),
    },
  }
}

function providerSupportsReasoning(provider: AIProvider, model?: string): boolean {
  if (!model) return !!provider.capabilities?.reasoningEffort
  return !!provider.capabilities?.reasoningEffort || /(^|\/)(o[1-9]|gpt-5)|reasoner|thinking|grok|glm/i.test(model)
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
        <IslandField
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

function QuickStartAction({ label, muted = false, onPress }: { label: string; muted?: boolean; onPress: () => void }) {
  const { colors } = useAppTheme()
  return (
    <PressableScale
      haptic
      onPress={onPress}
      style={{
        minHeight: 36,
        borderRadius: 18,
        paddingHorizontal: 13,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: muted ? colors.islandRaised : colors.text,
        borderWidth: muted ? 1 : 0,
        borderColor: colors.border,
      }}
    >
      <Text style={{ color: muted ? colors.textSecondary : colors.surface, fontSize: 12, fontWeight: '900' }}>{label}</Text>
    </PressableScale>
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

function OnboardingCard({ icon, title, onPress }: { icon: ReactNode; title: string; onPress: () => void }) {
  const { colors } = useAppTheme()
  return (
    <IslandListItem
      title={title}
      onPress={onPress}
      leading={<View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mintSoft }}>{icon}</View>}
    />
  )
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
  t: TFunction
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
  if (!provider.models.includes(conversation.model)) {
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
  if (provider.lastTestStatus === 'bad' && provider.lastTestCode && provider.lastTestCode !== 'ok' && (!provider.lastTestModel || provider.lastTestModel === conversation.model)) {
    return health(provider.lastTestCode, inheritedExpired, provider.id, provider.name, provider.lastTestMessage || t('chat.lastTestFailed'), t)
  }
  const config = getModelConfig(conversation.model, provider.type, provider.modelConfigs)
  if (config.deprecated) {
    return health('model_unavailable', inheritedExpired, provider.id, provider.name, t('chat.modelDeprecated', { model: getModelName(conversation.model) }), t)
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
        borderRadius: compact ? 18 : 24,
        padding: compact ? 10 : 13,
        backgroundColor: colors.islandRaised,
        borderWidth: 1,
        borderColor,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ width: compact ? 28 : 34, height: compact ? 28 : 34, borderRadius: compact ? 14 : 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.islandRaised }}>
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
        <BannerAction label={t('chat.configure')} onPress={onConfigure} compact={compact} />
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

function BannerAction({ label, compact = false, disabled = false, onPress }: { label: string; compact?: boolean; disabled?: boolean; onPress: () => void }) {
  const { colors } = useAppTheme()
  return (
    <PressableScale
      haptic
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: compact ? 30 : 34,
        borderRadius: compact ? 15 : 17,
        paddingHorizontal: compact ? 10 : 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.islandRaised,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <Text style={{ color: colors.text, fontSize: compact ? 11 : 12, fontWeight: '800' }}>{label}</Text>
    </PressableScale>
  )
}

function formatTokenLimit(value: number): string {
  if (value >= 1000000) return `${Math.round(value / 100000) / 10}M`
  if (value >= 1000) return `${Math.round(value / 1000)}K`
  return String(value)
}

function formatHeaderMeta(conversation: Conversation, provider: AIProvider | undefined, metrics: ReturnType<typeof localDataStore.getConversationMetrics>, t: TFunction): string {
  if (conversation.providerId === 'local-setup') return t('chat.localNoNetwork')
  const config = getModelConfig(conversation.model, provider?.type, provider?.modelConfigs)
  const parts = [
    t('chat.contextMeta', { value: formatTokenLimit(config.contextWindow) }),
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
  metrics: ReturnType<typeof localDataStore.getConversationMetrics>,
  providerHealth: ConversationHealth | null,
  t: TFunction
): { title: string; subtitle?: string } {
  const enabledProviders = providers.filter((item) => item.id !== 'local-setup' && item.enabled)
  const hasEnabledProvider = enabledProviders.length > 0
  const hasAvailableModel = enabledProviders.some((item) => item.models.length > 0)
  if (!hasEnabledProvider) return { title: t('chat.noProviderConnected') }
  if (!hasAvailableModel) return { title: t('chat.noAvailableModels') }
  if (conversation.providerId === 'local-setup') {
    const fallbackProvider = enabledProviders.find((item) => item.models.length > 0)
    return {
      title: fallbackProvider?.name ?? t('settings.providerManagement'),
      subtitle: fallbackProvider?.models[0] ? getModelName(fallbackProvider.models[0]) : undefined,
    }
  }
  const modelLabel = getModelName(conversation.model)
  return {
    title: provider?.name ?? t('settings.providerManagement'),
    subtitle: providerHealth?.code
      ? `${providerHealth.title} · ${modelLabel}`
      : `${modelLabel} · ${formatHeaderMeta(conversation, provider, metrics, t)}`,
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`
  return `${Math.round(ms / 60000)}m`
}
