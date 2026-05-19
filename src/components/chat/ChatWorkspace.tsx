import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  KeyboardAvoidingView,
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
  type ViewStyle,
} from 'react-native'
import { FlashList, type FlashListRef } from '@shopify/flash-list'
import * as Clipboard from 'expo-clipboard'
import * as Linking from 'expo-linking'
import { router } from 'expo-router'
import { AlertTriangle, BookOpen, ChevronLeft, GitBranchPlus, History, KeyRound, ListEnd, Search, Settings2, Split, X } from 'lucide-react-native'
import { MotiView } from 'moti'
import { Screen } from '@/components/ui/Screen'
import { PressableScale } from '@/components/ui/PressableScale'
import { Pill } from '@/components/ui/Pill'
import { IslandPanel } from '@/components/ui/IslandPanel'
import { IslandHeader, IslandIconButton, IslandListItem, IslandSheet } from '@/components/ui/IslandPrimitives'
import { useIslandDialog } from '@/components/ui/IslandDialog'
import { Composer } from '@/components/chat/Composer'
import { MessageBubble } from '@/components/chat/MessageBubble'
import { EmptyState } from '@/components/ui/EmptyState'
import { copyMessageFinalText, recoverStaleStreamingMessages, regenerateLastAssistant, retryMessage, sendMessage, stopMessage } from '@/services/chatRunner'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { testProviderModelDetailed } from '@/services/ai/base'
import { localDataStore } from '@/services/localDataStore'
import { getModelConfig, getModelName, getProviderConfigIssue, getProviderModels } from '@/types'
import { speakText } from '@/services/speech'
import type { AIProvider, Attachment, ChatErrorCode, Conversation, Message, ProviderOperationCode } from '@/types'
import { collectMessageTraces, getActiveTraceTitle } from './tracePresentation'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useMainPagerGestureLock } from '@/components/main/MainPagerGestureLock'

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
  const dialog = useIslandDialog()
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const updateConversation = useChatStore((state) => state.updateConversation)
  const switchConversationModel = useChatStore((state) => state.switchConversationModel)
  const removeMessage = useChatStore((state) => state.removeMessage)
  const createLocalSetupConversation = useChatStore((state) => state.createLocalSetupConversation)
  const providers = useSettingsStore((state) => state.providers)
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
  const lastScrollOffset = useRef(0)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastAutoScrollAt = useRef(0)
  const provider = providers.find((item) => item.id === conversation?.providerId)
  const enabledProviders = useMemo(() => providers.filter((item) => item.id !== 'local-setup' && item.enabled), [providers])
  const hasEnabledProvider = enabledProviders.length > 0
  const hasAvailableModel = enabledProviders.some((item) => item.models.length > 0)
  const homeProvider = enabledProviders.find((item) => item.models.length > 0)
  const emptyHeaderTitle = !hasEnabledProvider ? '未连接服务商' : hasAvailableModel ? homeProvider?.name ?? '供应商' : '无可用模型'
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
  ].join('|') : conversation?.providerId ?? 'none', [conversation?.providerId, provider])
  const switchableProviders = useMemo(
    () => providers.filter((item) => item.id !== 'local-setup'),
    [providers]
  )
  const metrics = useMemo(() => localDataStore.getConversationMetrics(conversation), [conversation])
  const streamingMessage = conversation?.messages.find((message) => message.status === 'streaming')
  const isStreaming = !!streamingMessage
  const lastMessage = conversation?.messages.at(-1)
  const regenerableAssistantId = lastMessage?.role === 'assistant' ? lastMessage.id : undefined
  const messageSignature = conversation?.messages.map((message) => `${message.id}:${message.content.length}:${message.status}`).join('|')
  const activityLabel = streamingMessage ? getMessageActivityLabel(streamingMessage) : ''
  const chromeHidden = chromeCollapsed
  const optionsPanelHeight = Math.min(windowHeight * 0.52, 344)
  const listTopInset = Math.max(CHAT_TOP_FLOATING_SPACE, insets.top + 92)
  const composerBottomInset = Math.max(insets.bottom, 10) + CHAT_BOTTOM_FLOATING_SPACE
  const pendingNotice = pendingStreamingMessage
    ? pendingStreamingMessage.intent === 'guide'
      ? `引导待发送 · ${previewPendingText(pendingStreamingMessage.content, pendingStreamingMessage.attachments)}`
      : `队列待发送 · ${previewPendingText(pendingStreamingMessage.content, pendingStreamingMessage.attachments)}`
    : undefined
  const goHistory = onHistory ?? (() => router.push('/conversations'))
  const goSettings = onSettings ?? (() => router.push('/settings'))
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
    void resolveConversationHealth(conversation, providers, hydrateProviderKey).then((health) => {
      if (mounted) setProviderHealth(health)
    })
    return () => {
      mounted = false
    }
  }, [
    conversation?.id,
    conversation?.providerId,
    conversation?.model,
    conversation?.providerModelMode,
    hydrateProviderKey,
    providerHealthKey,
  ])

  useEffect(() => {
    if (!conversation?.id) return
    recoverStaleStreamingMessages(conversation.id)
  }, [conversation?.id])

  useEffect(() => {
    if (!isStreaming && pendingStreamingMessage && conversation) {
      const queued = pendingStreamingMessage
      setPendingStreamingMessage(null)
      void sendMessage({ conversation, content: queued.content, attachments: queued.attachments })
        .catch((error) => dialog.toast({ title: '待发送失败', message: error instanceof Error ? error.message : '队列中的消息没有成功发送。', tone: 'danger' }))
    }
  }, [conversation, dialog, isStreaming, pendingStreamingMessage])

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

  if (!conversation) {
    async function submitSetup(content: string, attachments: Attachment[]) {
      const id = createLocalSetupConversation()
      const localConversation = useChatStore.getState().conversations.find((item) => item.id === id)
      if (localConversation) {
        try {
          await sendMessage({ conversation: localConversation, content, attachments })
        } catch (error) {
          dialog.toast({ title: '发送失败', message: error instanceof Error ? error.message : '消息没有成功发送，请稍后重试。', tone: 'danger' })
        }
      }
    }

    return (
      <ScreenWrapper {...screenProps}>
        <View style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <PressableScale
              onPress={goHistory}
              accessibilityLabel="历史对话"
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
              accessibilityLabel="设置"
              style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: colors.text }}
            >
              <Settings2 color={colors.surface} size={18} strokeWidth={1.9} />
            </PressableScale>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 10) + CHAT_BOTTOM_FLOATING_SPACE }}>
            <EmptyState
              title="连接一个模型"
              actionLabel="配置服务商"
              onAction={goSettings}
            />
            <View style={{ gap: 10, marginTop: 18 }}>
              <OnboardingCard
                icon={<KeyRound color={colors.text} size={18} />}
                title="配置服务商"
                onPress={goSettings}
              />
              <OnboardingCard
                icon={<BookOpen color={colors.text} size={18} />}
                title="导入知识"
                onPress={goSettings}
              />
            </View>
          </ScrollView>
          <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14, paddingBottom: 12, paddingTop: 4 }}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
              <Composer streaming={false} onStop={() => undefined} onSend={submitSetup} />
            </KeyboardAvoidingView>
          </View>
        </View>
      </ScreenWrapper>
    )
  }

  const activeConversation = conversation

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

  async function submit(content: string, attachments: Attachment[]) {
    try {
      await sendMessage({ conversation: activeConversation, content, attachments })
    } catch (error) {
      dialog.toast({ title: '发送失败', message: error instanceof Error ? error.message : '消息没有成功发送，请稍后重试。', tone: 'danger' })
    }
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
            .catch((error) => dialog.toast({ title: '发送失败', message: error instanceof Error ? error.message : '打断后的消息没有成功发送。', tone: 'danger' }))
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
    dialog.toast({ title: result.ok ? '模型可用' : '模型不可用', message: result.ok ? `${activeConversation.model} 已通过测试。` : result.message, tone: result.ok ? 'mint' : 'danger' })
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
    setProviderHealth(await resolveConversationHealth(activeConversation, useSettingsStore.getState().providers, hydrateProviderKey))
    setTestingHeader(false)
    dialog.toast({ title: result.ok ? '模型可用' : '模型不可用', message: result.ok ? `${activeConversation.model} 已通过测试。` : result.message, tone: result.ok ? 'mint' : 'danger' })
  }

  function confirmSwitchModel(nextProvider: AIProvider, nextModel: string) {
    if (nextProvider.id === activeConversation.providerId && nextModel === activeConversation.model) return
    void (async () => {
      const nextConfig = getModelConfig(nextModel, nextProvider.type, nextProvider.modelConfigs)
      const currentConfig = getModelConfig(activeConversation.model, provider?.type, provider?.modelConfigs)
      const confirmed = await dialog.confirm({
        title: '切换当前会话模型？',
        message: '这只会影响当前会话；正在生成的回复会先停止，再切到新模型。',
        tone: 'amber',
        confirmLabel: '确认切换',
        cancelLabel: '取消',
        chips: [
          { label: nextProvider.name, tone: 'mint' },
          { label: getModelName(nextModel), tone: 'amber' },
          { label: '仅当前会话', tone: 'default' },
        ],
        metrics: [
          { label: '上下文窗口', before: formatTokenLimit(currentConfig.contextWindow), after: formatTokenLimit(nextConfig.contextWindow) },
          { label: '输出上限', before: formatTokenLimit(currentConfig.maxOutputTokens), after: formatTokenLimit(nextConfig.maxOutputTokens) },
        ],
      })
      if (!confirmed) return
      safeStopMessage(activeConversation.id)
      switchConversationModel(activeConversation.id, nextProvider.id, nextModel)
      dialog.toast({ title: '已切换模型', message: `${nextProvider.name} · ${getModelName(nextModel)}`, tone: 'mint' })
    })()
  }

  function safeStopMessage(conversationId: string) {
    try {
      stopMessage(conversationId)
    } catch (error) {
      dialog.toast({ title: '停止失败', message: error instanceof Error ? error.message : '当前请求没有成功停止，请稍后重试。', tone: 'danger' })
    }
  }

  async function copyConversationLink() {
    const url = Linking.createURL(`/chat/${activeConversation.id}`)
    await Clipboard.setStringAsync(url)
    dialog.toast({ title: '已复制会话链接', message: url, tone: 'mint' })
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
            conversation={conversation}
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
              data={conversation.messages}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              onScroll={handleListScroll}
              scrollEventThrottle={16}
              contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 28 }}
              ListHeaderComponent={renderConversationHeaderSpacer(providerHealth, colors)}
              renderItem={({ item: message, index }) => (
                <MessageBubble
                  key={message.id}
                  conversationId={conversation.id}
                  message={message}
                  index={index}
                  isLastAssistant={message.id === regenerableAssistantId}
                  onCopy={(item) => {
                    void copyMessageFinalText(item)
                      .then(() => dialog.toast({ title: '已复制', message: '消息内容已复制到剪贴板。', tone: 'mint' }))
                      .catch(() => dialog.toast({ title: '复制失败', message: '系统剪贴板暂时不可用。', tone: 'danger' }))
                  }}
                  onRetry={(item) => void retryMessage(conversation.id, item.id).catch((error) => dialog.toast({ title: '重试失败', message: error instanceof Error ? error.message : '无法重新发送这条消息。', tone: 'danger' }))}
                  onRegenerate={() => void regenerateLastAssistant(conversation.id).catch((error) => dialog.toast({ title: '重新生成失败', message: error instanceof Error ? error.message : '无法重新生成这条回复。', tone: 'danger' }))}
                  onSpeak={(item) => void speakText(item.responseText ?? item.content, provider)}
                  onDelete={(item) => removeMessage(conversation.id, item.id)}
                  onConfigure={goSettings}
                  onTestModel={(item) => void testCurrentModel(item)}
                />
              )}
              ListEmptyComponent={<EmptyConversationState onHistory={goHistory} onSettings={goSettings} />}
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
            onClearPending={() => setPendingStreamingMessage(null)}
            disabled={!provider && conversation.providerId !== 'local-setup'}
            onStop={() => safeStopMessage(conversation.id)}
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
  const header = getProviderHeaderState(conversation, provider, switchableProviders, metrics, providerHealth)
  const modelLabel = conversation.providerId === 'local-setup' ? '本地配置向导' : getModelName(conversation.model)
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
              <IslandIconButton label="返回" onPress={onBack}>
                {showOptions ? <ChevronLeft color={colors.text} size={18} strokeWidth={1.9} /> : <History color={colors.text} size={18} strokeWidth={1.8} />}
              </IslandIconButton>
            }
            trailing={
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <IslandIconButton label="会话参数" onPress={onToggleOptions} tone={showOptions ? 'amber' : 'default'}>
                  <ListEnd color={colors.textSecondary} size={17} strokeWidth={2} />
                </IslandIconButton>
                <IslandIconButton label="设置" onPress={onSettings} tone="ink">
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
              <FloatingOptionsPanel
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
            accessibilityLabel="显示顶部导航"
            hitSlop={12}
            style={{ minWidth: streaming ? 128 : 82, height: 34, borderRadius: 17, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.material.chrome, borderWidth: 1, borderColor: colors.border }}
          >
            <Text style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '900' }}>{streaming ? '生成中 · 点这里显示顶部栏' : '显示顶部栏'}</Text>
          </Pressable>
        </MotiView>
      ) : null}
    </View>
  )
}

function FloatingOptionsPanel({
  conversation,
  provider,
  switchableProviders,
  colors,
  maxHeight,
  onSwitchModel,
  onCopyLink,
}: {
  conversation: Conversation
  provider: AIProvider | undefined
  switchableProviders: AIProvider[]
  colors: ReturnType<typeof useAppTheme>['colors']
  maxHeight: number
  onSwitchModel: (provider: AIProvider, model: string) => void
  onCopyLink: () => void
}) {
  const updateConversation = useChatStore((state) => state.updateConversation)
  const [selectedProviderId, setSelectedProviderId] = useState(provider?.id ?? conversation.providerId)
  const [modelPickerQuery, setModelPickerQuery] = useState('')
  const currentProvider = provider
  const normalizedQuery = normalizeSearchText(modelPickerQuery)
  const orderedProviders = useMemo(
    () => sortSwitchableProviders(switchableProviders, conversation.providerId, normalizedQuery),
    [conversation.providerId, normalizedQuery, switchableProviders]
  )
  const selectedProvider =
    orderedProviders.find((item) => item.id === selectedProviderId) ??
    currentProvider ??
    orderedProviders[0]
  const visibleProviders = normalizedQuery
    ? orderedProviders.filter((item) => providerMatchesQuery(item, normalizedQuery))
    : orderedProviders.slice(0, 8)
  const selectedModels = selectedProvider
    ? getSwitchableProviderModels(selectedProvider, normalizedQuery)
      .map((id) => ({ id, name: getModelName(id), config: getModelConfig(id, selectedProvider.type, selectedProvider.modelConfigs) }))
    : []
  const selectedProviderIsCurrent = selectedProvider?.id === conversation.providerId
  const capabilities = currentProvider?.capabilities

  useEffect(() => {
    setSelectedProviderId(provider?.id ?? conversation.providerId)
  }, [conversation.providerId, provider?.id])

  useEffect(() => {
    if (!normalizedQuery || !visibleProviders.length) return
    if (!visibleProviders.some((item) => item.id === selectedProviderId)) {
      setSelectedProviderId(visibleProviders[0].id)
    }
  }, [normalizedQuery, selectedProviderId, visibleProviders])

  return (
    <IslandPanel material="chrome" elevated style={{ marginTop: 10, maxHeight }} radius={24} contentStyle={{ padding: 0 }}>
      <ScrollView
        style={{ maxHeight }}
        contentContainerStyle={{ padding: 12, paddingBottom: 14 }}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            minHeight: 42,
            borderRadius: 21,
            paddingHorizontal: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            backgroundColor: colors.material.field,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Search color={colors.textTertiary} size={15} strokeWidth={2} />
          <TextInput
            value={modelPickerQuery}
            onChangeText={setModelPickerQuery}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="搜索供应商或模型"
            placeholderTextColor={colors.textTertiary}
            style={{ flex: 1, minHeight: 40, padding: 0, color: colors.text, fontSize: 13, fontWeight: '800' }}
          />
          {modelPickerQuery.trim() ? (
            <PressableScale
              onPress={() => setModelPickerQuery('')}
              accessibilityLabel="清空模型搜索"
              style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.islandRaised }}
            >
              <X color={colors.textSecondary} size={14} strokeWidth={2.2} />
            </PressableScale>
          ) : null}
        </View>
        <View style={{ gap: 8, marginTop: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900' }}>供应商</Text>
            <Text style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '800' }}>
              {normalizedQuery ? `${visibleProviders.length}/${switchableProviders.length}` : `${switchableProviders.length} 个`}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {visibleProviders.map((item) => (
              <PressableScale
                key={item.id}
                haptic
                onPress={() => setSelectedProviderId(item.id)}
              >
                <Pill active={selectedProvider?.id === item.id}>{item.name}{item.enabled ? '' : ' · 停用'}</Pill>
              </PressableScale>
            ))}
            {!visibleProviders.length ? (
              <View style={{ borderRadius: 18, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.material.field, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ color: colors.textTertiary, fontSize: 12, lineHeight: 17 }}>没有匹配的供应商或模型。</Text>
              </View>
            ) : null}
          </View>
        </View>
        <View style={{ gap: 8, marginTop: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900' }}>模型</Text>
            <Text style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '800' }}>
              {selectedProvider?.name ?? '未选择'} · {selectedModels.length || '无'}
            </Text>
          </View>
          {selectedModels.length ? (
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {selectedModels.map((model) => (
                <PressableScale key={model.id} haptic onPress={() => selectedProvider && onSwitchModel(selectedProvider, model.id)}>
                  <Pill active={selectedProviderIsCurrent && conversation.model === model.id}>{model.name}{model.config.deprecated ? ' · 不推荐' : ''}</Pill>
                </PressableScale>
              ))}
            </View>
          ) : (
            <View style={{ borderRadius: 18, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.material.field, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ color: colors.textTertiary, fontSize: 12, lineHeight: 17 }}>这个供应商还没有可用模型。</Text>
            </View>
          )}
        </View>
        <Text style={{ color: colors.textTertiary, fontSize: 10, lineHeight: 15, marginTop: 8 }}>
          当前会话只在这里手动切换才会更新绑定，避免其他会话被自动改写。
        </Text>
        <View style={{ marginTop: 10 }}>
          <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '800', marginBottom: 6 }}>System Prompt</Text>
          <TextInput
            value={conversation.systemPrompt}
            onChangeText={(systemPrompt) => updateConversation(conversation.id, { systemPrompt })}
            multiline
            placeholder="例如：你是一个简洁、可靠的移动端助手。"
            placeholderTextColor={colors.textTertiary}
            style={{ minHeight: 72, maxHeight: 128, borderRadius: 18, padding: 12, color: colors.text, backgroundColor: colors.material.field, borderWidth: 1, borderColor: colors.border, fontSize: 13, lineHeight: 19 }}
          />
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <PressableScale haptic onPress={onCopyLink} style={{ minHeight: 34, borderRadius: 17, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.islandRaised, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '800' }}>复制会话链接</Text>
          </PressableScale>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <ParamInput
            label="Temperature"
            value={String(conversation.temperature)}
            onChange={(value) => {
              const next = Number(value)
              if (!Number.isNaN(next)) updateConversation(conversation.id, { temperature: Math.max(0, Math.min(2, next)) })
            }}
          />
          <ParamInput
            label="Max Tokens"
            value={String(conversation.maxTokens)}
            onChange={(value) => {
              const next = Number.parseInt(value, 10)
              const config = getModelConfig(conversation.model, currentProvider?.type, currentProvider?.modelConfigs)
              if (!Number.isNaN(next)) updateConversation(conversation.id, { maxTokens: Math.max(128, Math.min(config.maxOutputTokens, next)) })
            }}
          />
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          {capabilities?.topP !== false ? (
          <ParamInput
            label="Top P"
            value={String(conversation.topP ?? 1)}
            onChange={(value) => {
              const next = Number(value)
              if (!Number.isNaN(next)) updateConversation(conversation.id, { topP: Math.max(0, Math.min(1, next)) })
            }}
          />
          ) : null}
          {capabilities?.reasoningEffort ? (
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '800', marginBottom: 6 }}>Reasoning</Text>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {(['minimal', 'low', 'medium', 'high'] as const).map((effort) => (
                <PressableScale key={effort} haptic onPress={() => updateConversation(conversation.id, { reasoningEffort: effort })}>
                  <Pill active={(conversation.reasoningEffort ?? 'medium') === effort}>{effort}</Pill>
                </PressableScale>
              ))}
            </View>
          </View>
          ) : null}
        </View>
      </ScrollView>
    </IslandPanel>
  )
}

function getSwitchableProviderModels(provider: AIProvider, query = ''): string[] {
  const groups = provider.credentialGroups ?? []
  const models = Array.from(new Set([...provider.models, ...getProviderModels(provider.type).map((item) => item.id)]))
    .filter((id) => !groups.length || groups.some((group) => group.enabled && (!group.availableModels?.length || group.availableModels.includes(id))))
  if (!query) return models
  return models.filter((id) => normalizeSearchText(`${id} ${getModelName(id)}`).includes(query))
}

function sortSwitchableProviders(providers: AIProvider[], currentProviderId: string, query: string): AIProvider[] {
  return [...providers].sort((a, b) => {
    const aScore = getProviderPickerScore(a, currentProviderId, query)
    const bScore = getProviderPickerScore(b, currentProviderId, query)
    if (aScore !== bScore) return bScore - aScore
    return a.name.localeCompare(b.name)
  })
}

function getProviderPickerScore(provider: AIProvider, currentProviderId: string, query: string): number {
  let score = 0
  if (provider.id === currentProviderId) score += 120
  if (provider.enabled) score += 32
  const modelCount = getSwitchableProviderModels(provider).length
  score += Math.min(modelCount, 24)
  if (query) {
    if (normalizeSearchText(`${provider.name} ${provider.id} ${provider.baseUrl ?? ''}`).includes(query)) score += 80
    if (getSwitchableProviderModels(provider, query).length) score += 48
  }
  return score
}

function providerMatchesQuery(provider: AIProvider, query: string): boolean {
  if (!query) return true
  if (normalizeSearchText(`${provider.name} ${provider.id} ${provider.baseUrl ?? ''}`).includes(query)) return true
  return getSwitchableProviderModels(provider, query).length > 0
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function FloatingComposer({
  insets,
  streaming,
  activityLabel,
  pendingNotice,
  onClearPending,
  disabled,
  onStop,
  onSend,
  onSendWhileStreaming,
  onInteract,
}: {
  insets: ReturnType<typeof useSafeAreaInsets>
  streaming: boolean
  activityLabel: string
  pendingNotice?: string
  onClearPending: () => void
  disabled: boolean
  onStop: () => void
  onSend: (content: string, attachments: Attachment[]) => Promise<void> | void
  onSendWhileStreaming: (content: string, attachments: Attachment[]) => Promise<void> | void
  onInteract?: () => void
}) {
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 40 }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0} onTouchStart={onInteract}>
        <View pointerEvents="box-none" style={{ paddingHorizontal: 14, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 10) + 8 }}>
          <Composer
            disabled={disabled}
            streaming={streaming}
            activityLabel={activityLabel}
            pendingNotice={pendingNotice}
            onClearPending={onClearPending}
            onStop={onStop}
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
  const preview = previewPendingText(draft.content, draft.attachments)
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: Math.max(insets.bottom, 10) + 106, zIndex: 55, paddingHorizontal: 14 }}>
      <IslandSheet>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 14, fontWeight: '900' }}>当前回复还在生成</Text>
              <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 2, fontWeight: '700' }}>
                {preview}
              </Text>
            </View>
            <PressableScale
              haptic
              onPress={onCancel}
              accessibilityLabel="取消继续输入"
              style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.islandRaised }}
            >
              <X color={colors.textTertiary} size={16} strokeWidth={2.1} />
            </PressableScale>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 11 }}>
            <IntentAction label="引导" description="回复后优先发送" onPress={() => onChoose('guide')}>
              <GitBranchPlus color={colors.primary} size={16} strokeWidth={2.1} />
            </IntentAction>
            <IntentAction label="排队" description="作为下一条" onPress={() => onChoose('queue')}>
              <ListEnd color={colors.primary} size={16} strokeWidth={2.1} />
            </IntentAction>
            <IntentAction label="打断" description="停止并发送" danger onPress={() => onChoose('interrupt')}>
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
  colors: ReturnType<typeof useAppTheme>['colors']
) {
  return (
    <View style={{ gap: 8, marginBottom: 4 }}>
      {providerHealth?.code ? (
        <Text style={{ color: providerHealth.inheritedExpired ? colors.error : colors.warning, fontSize: 11, fontWeight: '800' }}>
          {providerHealth.inheritedExpired ? '自动继承配置已失效' : '当前会话配置异常'}
        </Text>
      ) : null}
    </View>
  )
}

function EmptyConversationState({ onHistory, onSettings }: { onHistory: () => void; onSettings: () => void }) {
  const { colors } = useAppTheme()
  return (
    <View style={{ paddingTop: 36, gap: 14 }}>
      <EmptyState
        title="新对话"
      />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <QuickStartAction label="配置服务商" onPress={onSettings} />
        <QuickStartAction label="导入知识" onPress={onSettings} muted />
        <QuickStartAction label="历史对话" onPress={onHistory} muted />
      </View>
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

function getMessageActivityLabel(message: Message): string {
  const traces = collectMessageTraces(message)
  return getActiveTraceTitle(traces, message.status) || messageActivityStatusLabel(message)
}

function messageActivityStatusLabel(message: Message): string {
  switch (message.status) {
    case 'sending':
      return '准备中'
    case 'streaming':
      return '生成中'
    case 'error':
      return '失败'
    case 'cancelled':
      return '已停止'
    case 'done':
      return '已完成'
  }
}

function previewPendingText(content: string, attachments: Attachment[]): string {
  const text = content.trim().replace(/\s+/g, ' ')
  const label = text ? (text.length > 24 ? `${text.slice(0, 24)}...` : text) : '附件消息'
  return attachments.length ? `${label} · ${attachments.length} 个附件` : label
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
  hydrateProviderKey: (id: string) => Promise<AIProvider | null>
): Promise<ConversationHealth | null> {
  if (!conversation || conversation.providerId === 'local-setup') return null
  const provider = providers.find((item) => item.id === conversation.providerId)
  const inheritedExpired = (conversation.providerModelMode ?? 'inherited') === 'inherited'
  if (!provider) {
    return {
      code: 'provider_missing',
      title: inheritedExpired ? '自动继承的服务商已不存在' : '当前服务商不存在',
      description: `此会话仍绑定 ${conversation.providerId}，不会自动跳到其他服务商，以免破坏上下文。`,
      inheritedExpired,
      providerId: conversation.providerId,
    }
  }
  if (!provider.enabled) {
    return health('disabled_provider', inheritedExpired, provider.id, provider.name, '当前会话绑定的服务商已停用。')
  }
  if (!provider.models.includes(conversation.model)) {
    return health('model_unavailable', inheritedExpired, provider.id, provider.name, `当前模型 ${conversation.model} 不在 ${provider.name} 的模型列表中。`)
  }
  const keyedProvider = await hydrateProviderKey(provider.id)
  if (!keyedProvider?.apiKey.trim()) {
    return health('missing_key', inheritedExpired, provider.id, provider.name, '当前服务商缺少 API Key。')
  }
  const issue = getProviderConfigIssue(keyedProvider, keyedProvider.apiKey)
  if (issue) {
    return health(issue.code, inheritedExpired, provider.id, provider.name, issue.message)
  }
  if (provider.lastTestStatus === 'bad' && provider.lastTestCode && provider.lastTestCode !== 'ok' && (!provider.lastTestModel || provider.lastTestModel === conversation.model)) {
    return health(provider.lastTestCode, inheritedExpired, provider.id, provider.name, provider.lastTestMessage || '上次测试失败，建议重新测试当前模型。')
  }
  const config = getModelConfig(conversation.model, provider.type, provider.modelConfigs)
  if (config.deprecated) {
    return health('model_unavailable', inheritedExpired, provider.id, provider.name, `${getModelName(conversation.model)} 已标记为不推荐或过期，请确认还能继续使用。`)
  }
  return { code: null, title: '', description: '', inheritedExpired, providerId: provider.id }
}

function health(
  code: ConversationHealth['code'],
  inheritedExpired: boolean,
  providerId: string,
  providerName: string,
  description: string
): ConversationHealth {
  return {
    code,
    title: inheritedExpired ? '自动继承的会话配置已失效' : '当前会话配置异常',
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
              请手动选择一个可用模型。
            </Text>
          ) : null}
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: compact ? 8 : 10 }}>
        <BannerAction label="去配置" onPress={onConfigure} compact={compact} />
        <BannerAction
          label={testing ? '测试中' : compact ? '测试' : '测试当前模型'}
          onPress={onTest}
          compact={compact}
          disabled={testing || health.code === 'missing_key' || health.code === 'disabled_provider' || health.code === 'provider_missing'}
        />
        <BannerAction label={compact ? '切换' : '切换模型'} onPress={onSwitch} compact={compact} />
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

function formatHeaderMeta(conversation: Conversation, provider: AIProvider | undefined, metrics: ReturnType<typeof localDataStore.getConversationMetrics>): string {
  if (conversation.providerId === 'local-setup') return '本地提示 · 不发送网络请求'
  const config = getModelConfig(conversation.model, provider?.type, provider?.modelConfigs)
  const parts = [
    `上下文 ${formatTokenLimit(config.contextWindow)}`,
    `输出 ${formatTokenLimit(conversation.maxTokens || config.defaultMaxTokens)}`,
    metrics.totalTokens ? `本会话 ${formatTokenLimit(metrics.totalTokens)} tokens${metrics.estimated ? ' 估算' : ''}` : '',
    metrics.durationMs ? `累计 ${formatDuration(metrics.durationMs)}` : '',
  ].filter(Boolean)
  return parts.join(' · ')
}

function getProviderHeaderState(
  conversation: Conversation,
  provider: AIProvider | undefined,
  providers: AIProvider[],
  metrics: ReturnType<typeof localDataStore.getConversationMetrics>,
  providerHealth: ConversationHealth | null
): { title: string; subtitle?: string } {
  const enabledProviders = providers.filter((item) => item.id !== 'local-setup' && item.enabled)
  const hasEnabledProvider = enabledProviders.length > 0
  const hasAvailableModel = enabledProviders.some((item) => item.models.length > 0)
  if (!hasEnabledProvider) return { title: '未连接服务商' }
  if (!hasAvailableModel) return { title: '无可用模型' }
  if (conversation.providerId === 'local-setup') {
    const fallbackProvider = enabledProviders.find((item) => item.models.length > 0)
    return {
      title: fallbackProvider?.name ?? '供应商',
      subtitle: fallbackProvider?.models[0] ? getModelName(fallbackProvider.models[0]) : undefined,
    }
  }
  const modelLabel = getModelName(conversation.model)
  return {
    title: provider?.name ?? '供应商',
    subtitle: providerHealth?.code
      ? `${providerHealth.title} · ${modelLabel}`
      : `${modelLabel} · ${formatHeaderMeta(conversation, provider, metrics)}`,
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`
  return `${Math.round(ms / 60000)}m`
}

function ParamInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const { colors } = useAppTheme()
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '800', marginBottom: 6 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="numeric"
        placeholderTextColor={colors.textTertiary}
        style={{ minHeight: 46, borderRadius: 18, paddingHorizontal: 14, color: colors.text, backgroundColor: colors.material.field, borderWidth: 1, borderColor: colors.border, fontSize: 14, fontWeight: '700' }}
      />
    </View>
  )
}
