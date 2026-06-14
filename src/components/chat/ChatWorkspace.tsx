import type { PropsWithChildren, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import {
  AppState,
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
  type AppStateStatus,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type ViewStyle,
} from 'react-native'
import { FlashList, type FlashListRef } from '@shopify/flash-list'
import * as Clipboard from 'expo-clipboard'
import * as Linking from 'expo-linking'
import { router } from 'expo-router'
import { AlertTriangle, Bot, Brain, BrainCircuit, BrainCog, ChevronRight, FileText, GitBranchPlus, ListEnd, Sparkles, Split, Square, Wrench, X } from 'lucide-react-native'
import { MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import { AnimatedNavigationIcon, type NavigationGlyph } from '@/components/navigation/AnimatedNavigationIcon'
import { AnimatedNavigationTrigger, useNavigationTrigger } from '@/components/navigation/AnimatedNavigationTrigger'
import { IsleScreen, type IsleBackgroundState } from '@/components/ui/isle'
import { IsleOverlayPressable, IslePressable } from '@/components/ui/isle'
import { IsleField, IsleIconButton, IsleSheet } from '@/components/ui/isle'
import { useIsleDialog } from '@/components/ui/isle'
import { Composer } from '@/components/chat/Composer'
import type { ComposerCommand } from '@/components/chat/Composer'
import { ChatOptionsPanel } from '@/components/chat/ChatOptionsPanel'
import { MessageBubble } from '@/components/chat/MessageBubble'
import { IsleEmptyState } from '@/components/ui/isle'
import { confirmAgentAction, copyMessageFinalText, recoverStaleStreamingMessages, regenerateLastAssistant, retryMessage, saveAgentWorkflowSkillFromMessage, sendMessage, stopMessage } from '@/services/chatRunner'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { testProviderModelDetailed } from '@/services/ai/base'
import { getConversationMetrics, type ConversationMetrics } from '@/services/conversationMetrics'
import { getModelConfig, getModelName, getProviderConfigIssue } from '@/types'
import { speakText } from '@/services/speech'
import { buildAgentWorkflowSkillSavePreview, isSkillSelectableWithAgentWorkflowState, type AgentWorkflowSkillSavePreview } from '@/services/agent/agentWorkflowSkills'
import { getAgentEvidenceRepairActionFromMessage, getAgentPendingActionFromMessage, getAgentWorkflowContinuationActionFromMessage, getAgentWorkflowRecoveryActionFromMessage, getAgentWorkflowSkillSuggestionFromMessage } from '@/services/agent/agentMessageAdapter'
import { clampAgentOutput, redactSensitiveText } from '@/services/agent/agentTrace'
import type { AgentRequestedOutput } from '@/services/agent'
import type { AIProvider, Attachment, ChatErrorCode, Conversation, Message, ProcessTrace, ProviderOperationCode } from '@/types'
import type { CommandReference, KnowledgeDocument, MemoryItem, SkillDefinition } from '@/types'
import { collectMessageTraces, collectVisibleProcessTraces, formatProcessTraceForCopy, getActiveTraceTitle, isAgentWorkflowEnvelopeTrace } from './tracePresentation'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useMainPagerGestureLock } from '@/components/main/MainPagerGestureLock'
import { applySkillStack, createBaseSkill, extractSkillVariables, listSkills, upsertSkill } from '@/services/skills'
import { listKnowledgeDocuments, listMemories } from '@/services/contextStore'
import { getProviderAvailableModels, getProviderDisplayModel, hasRemoteProviderModelEvidence, inferModelFamily, isProviderConversationReady, MODEL_QUICK_GROUPS, resolveProviderModelAlias, type ModelQuickGroup } from '@/utils/providerModels'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'
import { getReasoningEffortOptions, providerSupportsReasoning } from '@/utils/modelReasoning'
import { getOnboardingConversationDefaults } from '@/utils/onboardingProfile'
import { summarizeWorkArtifact, validateWorkArtifactQuality } from '@/utils/workArtifact'
import { getPolicyAllowedProviderModels as getAccessAllowedProviderModels, getPolicyPreferredProviderModel as getAccessPreferredProviderModel, providerHasPolicyAllowedModel as accessProviderHasPolicyAllowedModel, resolveProviderModelAliasAccess } from '@/services/ai/policy/providerModelAccess'
import { clearAndroidStatusNotification, updateAndroidStatusNotification } from '@/services/androidStatusNotification'

type StreamingInputIntent = 'guide' | 'queue' | 'interrupt'
type ComposerPanel = 'model' | 'reasoning' | 'prompt' | 'more' | null
type ChatOptionsPlacement = 'popover' | 'sheet'

interface ModelQuickOption {
  id: string
  provider: AIProvider
  model: string
  family: ModelQuickGroup
}

interface HomeModelHighlight extends ModelQuickOption {
  selected: boolean
}

const COMPOSER_COLLAPSED_MIN_HEIGHT = 78
const AUTO_SCROLL_DELAY_MS = 96
const USER_SCROLL_PAUSE_THRESHOLD = 72
const FLASH_LIST_AUTO_SCROLL_THRESHOLD = 8
const LONG_MESSAGE_LIST_ANIMATION_THRESHOLD = 48
const MESSAGE_LIST_TOUCH_PAGER_GESTURE_RELEASE_DELAY_MS = 120
const MESSAGE_LIST_MOMENTUM_ELIGIBILITY_MS = 240
const QUICK_START_ACTION_HIT_SLOP = { top: 8, right: 8, bottom: 8, left: 8 }
const QUICK_TOOL_HIT_SLOP = { top: 8, right: 6, bottom: 8, left: 6 }
const FLOATING_CHROME_SAFE_AREA_GAP = 0
const FLOATING_CHROME_ANDROID_TOP_GAP = Platform.OS === 'android' ? 12 : 0
const FLOATING_CHROME_BOTTOM_PADDING = 6
const FLOATING_CHROME_IDLE_COLLAPSE_DELAY_MS = 1800
const FLOATING_CHROME_SWIPE_COLLAPSE_DISTANCE = 28
const COLLAPSED_CHROME_TOP_OFFSET = 2
const COLLAPSED_CHROME_HEIGHT = 44
const MESSAGE_LIST_CHROME_GAP = 8
const MESSAGE_LIST_COMPOSER_GAP = 12
const EMPTY_CONVERSATION_DEFAULT_TOP_PADDING = 36
const HOME_MODEL_HIGHLIGHT_LIMIT = 4
const ANDROID_UNDO_OPERATIONS_PROMPT_LIMIT = 2400
const ANDROID_UNDO_OPERATION_PROMPT_ITEM_LIMIT = 1200
const ANDROID_UNDO_OPERATION_PROMPT_MAX_ITEMS = 20
const ANDROID_UNDO_PROMPT_TEXT_LIMIT = 1400
const ANDROID_UNDO_PROMPT_FIELD_LIMIT = 360

interface PendingStreamingMessage {
  intent: Exclude<StreamingInputIntent, 'interrupt'>
  content: string
  attachments: Attachment[]
  requestedOutput: AgentRequestedOutput
}

interface IntentDraft {
  content: string
  attachments: Attachment[]
  requestedOutput: AgentRequestedOutput
}

interface ComposerDraftPayload {
  content: string
  key: string
  attachments?: Attachment[]
  restoreIfEmpty?: boolean
}

interface MessageScrollViewport {
  contentHeight: number
  viewportHeight: number
  scrollY: number
  awayFromBottom: boolean
}

function createEmptyMessageScrollViewport(): MessageScrollViewport {
  return {
    contentHeight: 0,
    viewportHeight: 0,
    scrollY: 0,
    awayFromBottom: false,
  }
}

function boundedAgentWorkflowResult(message: Message): string {
  return safePromptText(message.responseText ?? message.content, ANDROID_UNDO_PROMPT_TEXT_LIMIT)
}

function safeAgentWorkflowStarterPrompt(value: unknown): string {
  return safePromptText(value, ANDROID_UNDO_PROMPT_TEXT_LIMIT)
}

function readCompletedWorkArtifactTraceFollowUpPrompt(message: Message): string {
  const continuationAction = getAgentWorkflowContinuationActionFromMessage(message)
  if (continuationAction?.reason !== 'work-artifact-follow-up') return ''
  return safeAgentWorkflowStarterPrompt(continuationAction.suggestedUserPrompt)
}

function readValidatedWorkArtifactBodyFollowUpPrompt(message: Message): string {
  const workArtifact = summarizeWorkArtifact(message.responseText ?? message.content)
  const audit = validateWorkArtifactQuality(workArtifact)
  if (!audit.ok) return ''
  return safeAgentWorkflowStarterPrompt(workArtifact.followUpPrompt)
}

function buildAgentWorkflowSettingsParams(message: Message): Record<string, string> | undefined {
  const recoveryAction = getAgentWorkflowRecoveryActionFromMessage(message)
  if (!recoveryAction || recoveryAction.reason === 'workflow-selection-ambiguous') return undefined
  const workflowId = safePromptText(recoveryAction.workflowId, 96)
  const workflowName = safePromptText(recoveryAction.workflowName, 96)
  const workflowExpectedOutput = safePromptText(recoveryAction.workflowExpectedOutput, 80)
  return {
    focus: 'agent-workflow',
    reason: recoveryAction.reason,
    ...(workflowId ? { workflowId } : {}),
    ...(workflowName ? { workflowName } : {}),
    ...(workflowExpectedOutput ? { workflowExpectedOutput } : {}),
  }
}

function buildAndroidUndoPromptContext(message: Message, t: TFunction): string {
  const undoTrace = findAndroidUndoFollowUpTrace(message)
  const metadata = undoTrace?.metadata
  const summary = safePromptText(metadata?.androidUndoSummary, ANDROID_UNDO_PROMPT_FIELD_LIMIT)
  const undoOperations = collectAndroidUndoOperationsFromMessage(message)
  const undoOperationsJson = undoOperations.length
    ? safePromptText(JSON.stringify(undoOperations, null, 2), ANDROID_UNDO_OPERATIONS_PROMPT_LIMIT)
    : ''
  const previousResult = boundedAgentWorkflowResult(message) || t('messageBubble.emptyResponse')
  const toolName = metadata?.androidUndoToolName === 'android.files.undo_operations'
    ? metadata.androidUndoToolName
    : 'android.files.undo_operations'
  return [
    `Undo tool: ${toolName}`,
    undoOperations.length ? `Undo operations: ${undoOperations.length}` : typeof metadata?.androidUndoOperationCount === 'number' ? `Undo operations: ${Math.max(0, Math.floor(metadata.androidUndoOperationCount))}` : '',
    undoOperationsJson ? 'Undo operations JSON:' : '',
    undoOperationsJson,
    metadata?.androidUndoRequiresVisibleConfirmation === true ? 'Visible confirmation required: yes' : 'Visible confirmation required: required before applying',
    'Delete-based rollback: unsupported',
    summary ? `Trace summary: ${summary}` : '',
    '',
    'Previous result:',
    previousResult,
  ].filter((line) => line !== '').join('\n')
}

function collectAndroidUndoOperationsFromMessage(message: Message): unknown[] {
  for (const trace of collectMessageTraces(message)) {
    if (!isAndroidUndoOperationManifestTrace(trace)) continue
    const parsed = parseJsonObject(trace.content)
    const undoOperations = parsed ? readArray(parsed.undoOperations) : undefined
    const safeOperations = sanitizeAndroidUndoOperationsForPrompt(undoOperations)
    if (safeOperations.length) return safeOperations
  }
  return []
}

function findAndroidUndoFollowUpTrace(message: Message): ProcessTrace | undefined {
  return collectMessageTraces(message).find(isAndroidUndoFollowUpTrace)
}

function isAndroidUndoFollowUpTrace(trace: ProcessTrace): boolean {
  const metadata = trace.metadata
  return isWorkflowAndroidUndoFollowUpTrace(trace) &&
    typeof metadata?.androidUndoOperationCount === 'number' &&
    metadata.androidUndoOperationCount > 0 &&
    metadata.androidUndoToolName === 'android.files.undo_operations' &&
    metadata.androidUndoRequiresVisibleConfirmation === true
}

function isWorkflowAndroidUndoFollowUpTrace(trace: ProcessTrace): boolean {
  return isAgentWorkflowEnvelopeTrace(trace)
}

function isAndroidUndoOperationManifestTrace(trace: ProcessTrace): boolean {
  const metadata = trace.metadata
  return trace.type === 'tool' &&
    metadata?.source === 'android' &&
    metadata?.toolId === 'android:files.apply_operations'
}

function parseJsonObject(value: string | undefined): Record<string, unknown> | undefined {
  if (!value?.trim()) return undefined
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

function readArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined
}

function sanitizeAndroidUndoOperationsForPrompt(value: unknown[] | undefined): unknown[] {
  if (!value?.length) return []
  return value
    .map(sanitizeAndroidUndoOperationForPrompt)
    .filter((operation): operation is Record<string, unknown> => Boolean(operation))
    .slice(0, ANDROID_UNDO_OPERATION_PROMPT_MAX_ITEMS)
}

function sanitizeAndroidUndoOperationForPrompt(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const sanitized = sanitizeAndroidUndoPromptValue(value, 0)
  if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) return undefined
  const serialized = JSON.stringify(sanitized)
  if (serialized.length <= ANDROID_UNDO_OPERATION_PROMPT_ITEM_LIMIT) return sanitized as Record<string, unknown>
  const record = sanitized as Record<string, unknown>
  return {
    ...(typeof record.id === 'string' ? { id: record.id } : {}),
    ...(typeof record.action === 'string' ? { action: record.action } : {}),
    ...(typeof record.sourceName === 'string' ? { sourceName: record.sourceName } : {}),
    ...(typeof record.targetName === 'string' ? { targetName: record.targetName } : {}),
    requiresUserConfirmation: record.requiresUserConfirmation === true,
    truncated: true,
  }
}

function sanitizeAndroidUndoPromptValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return safePromptText(value, ANDROID_UNDO_PROMPT_FIELD_LIMIT)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) {
    if (depth >= 3) return '[redacted]'
    return value.slice(0, ANDROID_UNDO_OPERATION_PROMPT_MAX_ITEMS).map((item) => sanitizeAndroidUndoPromptValue(item, depth + 1))
  }
  if (value && typeof value === 'object') {
    if (depth >= 3) return '[redacted]'
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value).slice(0, 32)) {
      const safeKey = safePromptText(key, 80)
      if (!safeKey) continue
      result[safeKey] = isSensitivePromptKey(safeKey) ? '[redacted]' : sanitizeAndroidUndoPromptValue(child, depth + 1)
    }
    return result
  }
  return undefined
}

function safePromptText(value: unknown, limit: number): string {
  if (typeof value !== 'string') return ''
  return clampAgentOutput(redactSensitiveText(value.trim()), limit).trim()
}

function isSensitivePromptKey(value: string): boolean {
  return /(api[_-]?key|authorization|bearer|password|secret|token)/i.test(value)
}

type WorkflowSaveDialogTone = 'default' | 'mint' | 'amber' | 'danger'

function buildAgentWorkflowSaveConfirmOptions(message: Message, t: TFunction) {
  const suggestion = getAgentWorkflowSkillSuggestionFromMessage(message)
  if (!suggestion?.ok || !suggestion.skill) {
    return {
      message: t('messageBubble.saveAgentWorkflowMessage'),
      chips: undefined,
      metrics: undefined,
    }
  }

  const preview = buildAgentWorkflowSkillSavePreview(suggestion)
  const visibleTools = formatWorkflowSaveTools(preview, t)
  const chips: Array<{ label: string; tone?: WorkflowSaveDialogTone }> = [
    {
      label: t('messageBubble.saveAgentWorkflowPermission', { permission: preview.permissionCeiling }),
      tone: preview.permissionCeiling === 'destructive' ? 'danger' : preview.permissionCeiling === 'read-write' ? 'amber' : 'mint',
    },
    {
      label: preview.enabled ? t('messageBubble.saveAgentWorkflowEnabled') : t('messageBubble.saveAgentWorkflowDisabled'),
      tone: preview.enabled ? 'mint' : 'amber',
    },
    {
      label: t('messageBubble.saveAgentWorkflowStepCount', { count: preview.stepCount }),
      tone: 'default',
    },
    {
      label: t('messageBubble.saveAgentWorkflowToolCount', { count: preview.requiredTools.length }),
      tone: preview.requiredTools.length ? 'default' : 'amber',
    },
  ]
  if (preview.warningCount > 0) {
    chips.push({ label: t('messageBubble.saveAgentWorkflowWarningCount', { count: preview.warningCount }), tone: 'amber' })
  }

  return {
    message: t('messageBubble.saveAgentWorkflowMessage'),
    chips,
    metrics: [
      { label: t('messageBubble.saveAgentWorkflowMetricName'), before: preview.name },
      { label: t('messageBubble.saveAgentWorkflowMetricOutput'), before: preview.expectedOutput },
      { label: t('messageBubble.saveAgentWorkflowMetricTools'), before: visibleTools },
      ...(preview.ragProfileRequirements.length ? [{
        label: t('messageBubble.saveAgentWorkflowMetricRagProfile'),
        before: formatWorkflowSaveRagProfiles(preview, t),
      }] : []),
      ...(preview.acceptanceChecks.length ? [{
        label: t('messageBubble.saveAgentWorkflowMetricAcceptance'),
        before: formatWorkflowSaveAcceptance(preview, t),
      }] : []),
    ],
  }
}

function formatWorkflowSaveTools(preview: AgentWorkflowSkillSavePreview, t: TFunction): string {
  if (!preview.requiredTools.length) return t('messageBubble.saveAgentWorkflowNoTools')
  const visible = preview.requiredTools.slice(0, 3).join(', ')
  const remaining = preview.requiredTools.length - 3
  return remaining > 0
    ? `${visible}, ${t('messageBubble.saveAgentWorkflowMoreTools', { count: remaining })}`
    : visible
}

function formatWorkflowSaveRagProfiles(preview: AgentWorkflowSkillSavePreview, t: TFunction): string {
  const visible = preview.ragProfileRequirements.slice(0, 3).join(', ')
  const remaining = preview.ragProfileRequirements.length - 3
  return remaining > 0
    ? `${visible}, ${t('messageBubble.saveAgentWorkflowMoreTools', { count: remaining })}`
    : visible
}

function formatWorkflowSaveAcceptance(preview: AgentWorkflowSkillSavePreview, t: TFunction): string {
  const visible = preview.acceptanceChecks.slice(0, 3).join(', ')
  const remaining = preview.acceptanceChecks.length - 3
  return remaining > 0
    ? `${visible}, ${t('messageBubble.saveAgentWorkflowMoreTools', { count: remaining })}`
    : visible
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
  const visualTopInset = Platform.OS === 'android' ? 0 : Math.max(insets.top, 0)
  const { height: windowHeight, width: windowWidth } = useWindowDimensions()
  const motion = useMotionPreference()
  const chatMotion = Platform.OS === 'android' && motion === 'full' ? 'reduced' : motion
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
  const [chromeCollapsed, setChromeCollapsed] = useState(true)
  const [providerHealth, setProviderHealth] = useState<ConversationHealth | null>(null)
  const [testingHeader, setTestingHeader] = useState(false)
  const [pendingStreamingMessage, setPendingStreamingMessage] = useState<PendingStreamingMessage | null>(null)
  const [intentDraft, setIntentDraft] = useState<IntentDraft | null>(null)
  const [skills, setSkills] = useState<SkillDefinition[]>([])
  const selectableSkills = useMemo(() => skills.filter(isSkillSelectableWithAgentWorkflowState), [skills])
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeDocument[]>([])
  const [memoryItems, setMemoryItems] = useState<MemoryItem[]>([])
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const [keyboardBaselineHeight, setKeyboardBaselineHeight] = useState(windowHeight)
  const [composerFocused, setComposerFocused] = useState(false)
  const [composerPanel, setComposerPanel] = useState<ComposerPanel>(null)
  const [quickToolsCollapsed, setQuickToolsCollapsed] = useState(true)
  const [composerOutputMode, setComposerOutputMode] = useState<AgentRequestedOutput>('auto')
  const [quickStartDraft, setQuickStartDraft] = useState<ComposerDraftPayload | null>(null)
  const quickStartSequence = useRef(0)
  const initialSetupDefaults = useMemo(() => getOnboardingConversationDefaults(settings.onboardingCompanionMode), [settings.onboardingCompanionMode])
  const [setupReasoningEffort, setSetupReasoningEffort] = useState<NonNullable<Conversation['reasoningEffort']>>(initialSetupDefaults.reasoningEffort)
  const [setupSystemPrompt, setSetupSystemPrompt] = useState('')
  const [setupSelectedProviderId, setSetupSelectedProviderId] = useState<string | null>(null)
  const [setupSelectedModel, setSetupSelectedModel] = useState<string | null>(null)
  const [composerHeight, setComposerHeight] = useState(COMPOSER_COLLAPSED_MIN_HEIGHT)
  const lastScrollOffset = useRef(0)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastAutoScrollAt = useRef(0)
  const autoStickToBottom = useRef(true)
  const appStateRef = useRef<AppStateStatus | null>(AppState.currentState)
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
  const runtimeReasoningModel = provider && runtimeConversation ? resolveProviderModelAlias(provider, runtimeConversation.model) : runtimeConversation?.model
  const setupReasoningModel = homeProvider ? resolveProviderModelAlias(homeProvider, setupModel) : setupModel
  const supportsReasoningQuick = !!provider && providerSupportsReasoning(provider, runtimeReasoningModel)
  const supportsSetupReasoningQuick = !!homeProvider && providerSupportsReasoning(homeProvider, setupReasoningModel)
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
  const runtimeConversationId = runtimeConversation?.id
  const runtimeConversationTitle = runtimeConversation?.title
  const lastMessage = runtimeConversation?.messages.at(-1)
  const regenerableAssistantId = lastMessage?.role === 'assistant' ? lastMessage.id : undefined
  const messageSignature = runtimeConversation?.messages.map((message) => `${message.id}:${message.status}`).join('|')
  const activityLabel = streamingMessage ? getMessageActivityLabel(streamingMessage, t) : ''
  const compactViewport = windowHeight < 620 || windowWidth < 360
  const mobileChatViewport = windowWidth < 600
  const keepChromeExpanded = embedded && mobileChatViewport
  const androidResizeInset = Platform.OS === 'android' && keyboardHeight > 0
    ? Math.max(0, keyboardBaselineHeight - windowHeight)
    : 0
  const keyboardLift = Platform.OS === 'android'
    ? Math.max(0, keyboardHeight - androidResizeInset)
    : keyboardHeight
  const optionsPanelPlacement: ChatOptionsPlacement = windowWidth < 600 || windowHeight < 720 ? 'sheet' : 'popover'
  const optionsPanelKeyboardInset = optionsPanelPlacement === 'sheet' ? keyboardLift : 0
  const optionsPanelAvailableHeight = Math.max(
    260,
    windowHeight - visualTopInset - Math.max(insets.bottom, 10) - optionsPanelKeyboardInset - 88,
  )
  const optionsPanelPreferredHeight = Math.min(windowHeight * 0.7, compactViewport ? 460 : 620)
  const optionsPanelHeight = Math.max(260, Math.min(optionsPanelPreferredHeight, optionsPanelAvailableHeight))
  const effectiveInitialDraft = quickStartDraft?.content ?? initialDraft
  const effectiveInitialDraftKey = quickStartDraft?.key ?? initialDraftKey
  const effectiveInitialAttachments = quickStartDraft?.attachments
  const effectiveRestoreInitialDraftIfEmpty = quickStartDraft?.restoreIfEmpty
  const composerMinimumHeight = COMPOSER_COLLAPSED_MIN_HEIGHT
  const composerBottomInset = Math.max(composerMinimumHeight, composerHeight + Math.max(insets.bottom, 10) + 4)
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
  const openAgentWorkflowSettings = useCallback((message: Message) => {
    const params = buildAgentWorkflowSettingsParams(message)
    if (params) {
      pushSettingsRoute('/settings/skills', params)
      return
    }
    goSettings()
  }, [goSettings])
  const pendingNotice = pendingStreamingMessage
    ? pendingStreamingMessage.intent === 'guide'
      ? `${t('chat.pendingGuide')} · ${previewPendingText(pendingStreamingMessage.content, pendingStreamingMessage.attachments, t)}`
      : `${t('chat.pendingQueue')} · ${previewPendingText(pendingStreamingMessage.content, pendingStreamingMessage.attachments, t)}`
    : undefined

  useEffect(() => {
    if (!runtimeConversationId || settings.systemStatusNotificationsEnabled !== true || !isStreaming) {
      void clearAndroidStatusNotification()
      return
    }

    const activity = activityLabel || t('chat.generating')
    const conversationTitle = runtimeConversationTitle?.trim() || t('conversation.untitled')
    void updateAndroidStatusNotification({
      state: 'generating',
      title: t('chat.systemStatusGeneratingTitle'),
      message: t('chat.systemStatusGeneratingMessage', { conversation: conversationTitle, activity }),
      shortText: activity,
      conversationId: runtimeConversationId,
      deepLink: `islemind://chat/${runtimeConversationId}`,
      indeterminate: true,
      ongoing: true,
      requestPromotedOngoing: true,
    })
  }, [activityLabel, isStreaming, runtimeConversationId, runtimeConversationTitle, settings.systemStatusNotificationsEnabled, t])

  useEffect(() => () => {
    void clearAndroidStatusNotification()
  }, [])

  useEffect(() => {
    if (!keepChromeExpanded) return
    if (idleTimer.current) {
      clearTimeout(idleTimer.current)
      idleTimer.current = null
    }
    setChromeCollapsed(false)
  }, [keepChromeExpanded])

  useEffect(() => {
    if (keyboardHeight <= 0 || windowHeight > keyboardBaselineHeight) {
      setKeyboardBaselineHeight(windowHeight)
    }
  }, [keyboardBaselineHeight, keyboardHeight, windowHeight])

  const composerCommands = useMemo(
    () => (settings.commandPaletteEnabled ?? true) ? buildComposerCommands({
      skills: (settings.skillsEnabled ?? true) ? selectableSkills : [],
      t,
      onOpenKnowledge: goKnowledge,
      onOpenModelPicker: () => {
        markChromeActive()
        setShowOptions(true)
      },
      onApplySkill: (skill) => void applySkillToActiveConversation([skill]),
      onCreateDefaultSkill: () => void createDefaultSkill(),
    }) : [],
    [settings.commandPaletteEnabled, settings.skillsEnabled, selectableSkills, conversation?.id, t]
  )
  const composerReferences = useMemo(
    () => buildComposerReferences({
      providers,
      skills: selectableSkills,
      knowledgeDocuments,
      memoryItems,
      settings,
    }),
    [knowledgeDocuments, memoryItems, providers, settings, selectableSkills]
  )
  function scheduleChromeIdleCollapse() {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    if (keepChromeExpanded || showOptions || providerHealth?.code || testingHeader) {
      setChromeCollapsed(false)
      return
    }
    idleTimer.current = setTimeout(() => {
      setChromeCollapsed(true)
    }, FLOATING_CHROME_IDLE_COLLAPSE_DELAY_MS)
  }

  function markChromeActive() {
    setChromeCollapsed(false)
    if (!keepChromeExpanded) scheduleChromeIdleCollapse()
  }

  function restoreChrome() {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    setChromeCollapsed(false)
    if (!keepChromeExpanded) scheduleChromeIdleCollapse()
  }

  function applyQuickStartDraft(draft: string, attachments: Attachment[] = [], restoreIfEmpty = false) {
    if (!draft.trim() && attachments.length === 0) return
    quickStartSequence.current += 1
    setQuickStartDraft({
      content: draft,
      key: `composer-draft-${quickStartSequence.current}`,
      attachments: attachments.length > 0 ? attachments : undefined,
      restoreIfEmpty,
    })
    setShowOptions(false)
    setComposerPanel(null)
    markChromeActive()
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

  function toggleComposerOutputMode() {
    setComposerOutputMode((current) => current === 'work-artifact' ? 'auto' : 'work-artifact')
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
  }, [keyboardLift, messageSignature])

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
    if (!conversation?.id) return undefined
    const activeConversationId = conversation.id
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = appStateRef.current
      appStateRef.current = nextState
      if (nextState !== 'active' || previousState === 'active') return
      recoverStaleStreamingMessages(activeConversationId)
    })
    return () => subscription.remove()
  }, [conversation?.id])

  useEffect(() => {
    if (conversation) return
    setSetupReasoningEffort((current) => current === initialSetupDefaults.reasoningEffort ? current : initialSetupDefaults.reasoningEffort)
  }, [conversation, initialSetupDefaults.reasoningEffort])

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
      void sendMessage({ conversation: runtimeConversation, content: queued.content, attachments: queued.attachments, requestedOutput: queued.requestedOutput })
        .catch((error) => {
          applyQuickStartDraft(queued.content, queued.attachments, true)
          dialog.toast({ title: t('chat.pendingSendFailed'), message: error instanceof Error ? error.message : t('chat.pendingSendFailedMessage'), tone: 'danger' })
        })
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
      const nextHeight = Math.max(0, Math.ceil(event.endCoordinates.height))
      setKeyboardHeight((current) => Math.abs(current - nextHeight) < 2 ? current : nextHeight)
    })
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      setKeyboardHeight((current) => current === 0 ? current : 0)
    })
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])

  useEffect(() => {
    setPagerGestureLocked?.(showOptions || !!composerPanel || composerFocused || !!intentDraft)
    return () => setPagerGestureLocked?.(false)
  }, [composerFocused, composerPanel, intentDraft, setPagerGestureLocked, showOptions])

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
        applyQuickStartDraft(intentDraft.content, intentDraft.attachments, true)
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
        if (content.trim()) applyQuickStartDraft(content)
        if (hasEnabledProvider && !hasAvailableModel) {
          dialog.toast({ title: t('chat.noAvailableModels'), message: t('chat.syncModelsBeforeChat'), tone: 'amber' })
          return
        }
        dialog.toast({ title: t('chat.noProviderConnected'), message: t('chat.configureProviderBeforeChat'), tone: 'amber' })
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
          await sendMessage({ conversation: { ...nextConversation, systemPrompt: setupSystemPrompt, reasoningEffort: setupReasoningEffort, temperature: setupTemperature }, content, attachments, requestedOutput: composerOutputMode })
        } catch (error) {
          dialog.toast({ title: t('chat.sendFailed'), message: error instanceof Error ? error.message : t('chat.sendFailedMessage'), tone: 'danger' })
          throw error
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
              transition={{ type: 'timing', duration: chatMotion === 'full' ? motionTokens.duration.fast : 1 }}
              style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 55 }}
            >
              <IsleOverlayPressable
                accessibilityLabel={t('dialog.closeLayer')}
                onPress={() => setShowOptions(false)}
                style={{ flex: 1, backgroundColor: colors.backdrop }}
              />
            </MotiView>
          ) : null}
          <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 40, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <AnimatedNavigationTrigger
              variant="iconButton"
              label={t('conversation.title')}
              glyph="history"
              onNavigate={goHistory}
              color={colors.text}
              style={{ width: 44, height: 44, borderRadius: colors.ui.radius.controlLarge, backgroundColor: colors.ui.card.defaultBackground, borderWidth: 1, borderColor: colors.material.stroke }}
            />
            <View style={{ flex: 1 }}>
              <Pressable onPress={openSetupFullModelPanel} accessibilityRole="button" accessibilityLabel={t('chat.conversationOptions')} accessibilityHint={t('chat.conversationOptionsAccessibilityHint')} hitSlop={QUICK_START_ACTION_HIT_SLOP} style={{ minHeight: 44, justifyContent: 'center' }}>
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
              accessibilityRole="button"
              accessibilityLabel={t('chat.conversationOptions')}
              accessibilityHint={t('chat.conversationOptionsAccessibilityHint')}
              hitSlop={QUICK_START_ACTION_HIT_SLOP}
              style={{
                width: 44,
                height: 44,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: colors.ui.radius.controlLarge,
                backgroundColor: showOptions ? colors.ui.control.primaryBackground : colors.ui.card.mutedBackground,
                borderWidth: 1,
                borderColor: showOptions ? colors.ui.control.primaryBorder : colors.material.strokeStrong,
              }}
            >
              <ListEnd color={showOptions ? colors.ui.control.primaryForeground : colors.textSecondary} size={18} strokeWidth={1.9} />
            </IslePressable>
            <AnimatedNavigationTrigger
              variant="iconButton"
              label={t('settings.title')}
              glyph="settings-sliders"
              onNavigate={goSettings}
              externalActive={settingsTransitionActive}
              color={colors.text}
              style={{ width: 44, height: 44, borderRadius: colors.ui.radius.controlLarge, backgroundColor: colors.ui.card.mutedBackground, borderWidth: 1, borderColor: colors.material.strokeStrong }}
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
              paddingTop: Math.max(visualTopInset + 92, compactViewport ? 104 : 126),
              paddingBottom: composerBottomInset + keyboardLift,
            }}
          >
            <SetupEmptyState
              description={hasAvailableModel ? t('chat.askAnything') : hasEnabledProvider ? t('chat.syncModelsBeforeChat') : t('chat.configureProviderBeforeChat')}
              actionLabel={hasAvailableModel ? t('chat.startChat') : t('chat.configureProviders')}
              actionHint={hasAvailableModel ? t('chat.startChatAccessibilityHint') : t('chat.configureProvidersAccessibilityHint')}
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
              from={chatMotion === 'full' ? { opacity: 0, translateY: -8, scale: 0.985 } : { opacity: 0 }}
              animate={{ opacity: 1, translateY: 0, scale: 1 }}
              transition={chatMotion === 'full' ? { type: 'spring', ...motionTokens.spring.settle } : { type: 'timing', duration: motionTokens.duration.fast }}
              style={optionsPanelOverlayStyle(optionsPanelPlacement, visualTopInset, insets.bottom, optionsPanelKeyboardInset)}
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
            initialAttachments={effectiveInitialAttachments}
            restoreInitialDraftIfEmpty={effectiveRestoreInitialDraftIfEmpty}
            commands={composerCommands}
            references={composerReferences}
            reasoningEffort={setupReasoningEffort}
            provider={homeProvider ?? undefined}
            modelProviders={quickModelProviders}
            conversation={setupConversation}
            requestedOutput={composerOutputMode}
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
            onToggleRequestedOutput={toggleComposerOutputMode}
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
            motion={chatMotion}
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
      initialAttachments={effectiveInitialAttachments}
      restoreInitialDraftIfEmpty={effectiveRestoreInitialDraftIfEmpty}
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
      optionsPanelKeyboardInset={optionsPanelKeyboardInset}
      composerBottomInset={composerBottomInset}
      insets={insets}
      visualTopInset={visualTopInset}
      colors={colors}
      embedded={embedded}
      backgroundState={backgroundState}
      compactViewport={compactViewport}
      mobileViewport={mobileChatViewport}
      viewportHeight={windowHeight}
      showBack={showBack}
      goHistory={goHistory}
      goSettings={goSettings}
      goProviders={goProviders}
      goKnowledge={goKnowledge}
      openAgentWorkflowSettings={openAgentWorkflowSettings}
      onApplyStarter={applyQuickStartDraft}
      refreshSkills={async () => setSkills(await listSkills())}
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
      composerOutputMode={composerOutputMode}
      onToggleComposerOutputMode={toggleComposerOutputMode}
      setProviderHealth={setProviderHealth}
      setTestingHeader={setTestingHeader}
      composerPanel={composerPanel}
      setComposerPanel={setComposerPanel}
      setComposerHeight={setComposerHeight}
      quickToolsCollapsed={quickToolsCollapsed}
      toggleQuickTools={toggleQuickTools}
      collapseQuickTools={collapseQuickTools}
      motion={chatMotion}
      markChromeActive={markChromeActive}
      restoreChrome={restoreChrome}
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
  initialAttachments,
  restoreInitialDraftIfEmpty,
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
  optionsPanelKeyboardInset,
  composerBottomInset,
  insets,
  visualTopInset,
  colors,
  embedded,
  backgroundState,
  compactViewport,
  mobileViewport,
  viewportHeight,
  showBack,
  goHistory,
  goSettings,
  goProviders,
  goKnowledge,
  openAgentWorkflowSettings,
  onApplyStarter,
  refreshSkills,
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
  composerOutputMode,
  onToggleComposerOutputMode,
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
  restoreChrome,
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
  initialAttachments?: Attachment[]
  restoreInitialDraftIfEmpty?: boolean
  intentDraft: IntentDraft | null
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
  optionsPanelKeyboardInset: number
  composerBottomInset: number
  insets: ReturnType<typeof useSafeAreaInsets>
  visualTopInset: number
  colors: ReturnType<typeof useAppTheme>['colors']
  embedded: boolean
  backgroundState: IsleBackgroundState
  compactViewport: boolean
  mobileViewport: boolean
  viewportHeight: number
  showBack: boolean
  goHistory: () => void
  goSettings: () => void
  goProviders: () => void
  goKnowledge: () => void
  openAgentWorkflowSettings: (message: Message) => void
  onApplyStarter: (draft: string, attachments?: Attachment[], restoreIfEmpty?: boolean) => void
  refreshSkills: () => Promise<void>
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
  setIntentDraft: React.Dispatch<React.SetStateAction<IntentDraft | null>>
  composerOutputMode: AgentRequestedOutput
  onToggleComposerOutputMode: () => void
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
  restoreChrome: () => void
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
  const [chromeHeight, setChromeHeight] = useState(0)
  const [activeActionMessageId, setActiveActionMessageId] = useState<string | null>(null)
  const [messageScrollViewport, setMessageScrollViewport] = useState<MessageScrollViewport>(() => createEmptyMessageScrollViewport())
  const messageScrollViewportRef = useRef<MessageScrollViewport>(messageScrollViewport)
  const [shortConversationTopSpacer, setShortConversationTopSpacer] = useState(0)
  const messageListMaintainVisibleContentPosition = useMemo(
    () => ({
      autoscrollToBottomThreshold: FLASH_LIST_AUTO_SCROLL_THRESHOLD,
      animateAutoScrollToBottom: false,
      startRenderingFromBottom: true,
    }),
    []
  )
  const messageListMotion = activeConversation.messages.length >= LONG_MESSAGE_LIST_ANIMATION_THRESHOLD && motion === 'full'
    ? 'reduced'
    : motion
  const messageListMessageCountLabel = t(activeConversation.messages.length === 1 ? 'conversation.messageCountOne' : 'conversation.messageCountOther', {
    count: activeConversation.messages.length,
  })
  const messageListBaseAccessibilityValue = t(isStreaming ? 'chat.messageListGeneratingAccessibilityValue' : 'chat.messageListAccessibilityValue', {
    messageCount: messageListMessageCountLabel,
    activity: activityLabel || t('chat.generating'),
  })
  const messageListAccessibilityState = isStreaming ? { busy: true } : undefined
  const messageListAccessibilityValue = messageListBaseAccessibilityValue
  const userScrollInteractionActive = useRef(false)
  const messageListRightPadding = 20
  const messageListBottomPadding = MESSAGE_LIST_COMPOSER_GAP + composerBottomInset + keyboardLift
  const layoutScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestMessageScrollTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  const userDragMomentumEligible = useRef(false)
  const userDragMomentumEligibilityTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pagerGestureScrollReleaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persistentPagerGestureLockRef = useRef(false)
  const lastLayoutScrollAt = useRef(0)
  const chromeCollapseLocked = embedded && mobileViewport
  const collapsedChromeTop = visualTopInset + COLLAPSED_CHROME_TOP_OFFSET + FLOATING_CHROME_ANDROID_TOP_GAP
  const messageListTopInset = !chromeCollapsed
    ? chromeHeight + MESSAGE_LIST_CHROME_GAP
    : mobileViewport
      ? MESSAGE_LIST_CHROME_GAP
      : collapsedChromeTop + COLLAPSED_CHROME_HEIGHT + MESSAGE_LIST_CHROME_GAP
  const conversationHeaderTopPadding = shortConversationTopSpacer
  const emptyConversationTopPadding = Math.max(
    EMPTY_CONVERSATION_DEFAULT_TOP_PADDING,
    MESSAGE_LIST_CHROME_GAP
  )

  const clearLatestMessageScrollTimers = useCallback(() => {
    for (const timer of latestMessageScrollTimers.current) clearTimeout(timer)
    latestMessageScrollTimers.current.clear()
  }, [])
  const clearLayoutScrollTimer = useCallback(() => {
    if (!layoutScrollTimer.current) return
    clearTimeout(layoutScrollTimer.current)
    layoutScrollTimer.current = null
  }, [])
  const shouldAutoFollowLatestMessage = useCallback(() => {
    const viewport = messageScrollViewportRef.current
    return autoStickToBottom.current &&
      !userScrollInteractionActive.current &&
      (!viewport.viewportHeight || !viewport.awayFromBottom)
  }, [autoStickToBottom])

  useEffect(() => {
    messageScrollViewportRef.current = messageScrollViewport
  }, [messageScrollViewport])

  useEffect(() => {
    persistentPagerGestureLockRef.current = showOptions || !!composerPanel || keyboardVisible || !!intentDraft
  }, [composerPanel, intentDraft, keyboardVisible, showOptions])

  const clearPagerGestureScrollReleaseTimer = useCallback(() => {
    if (!pagerGestureScrollReleaseTimer.current) return
    clearTimeout(pagerGestureScrollReleaseTimer.current)
    pagerGestureScrollReleaseTimer.current = null
  }, [])

  const lockPagerGestureForMessageScroll = useCallback(() => {
    clearPagerGestureScrollReleaseTimer()
    setPagerGestureLocked?.(true)
  }, [clearPagerGestureScrollReleaseTimer, setPagerGestureLocked])

  const releasePagerGestureAfterMessageScroll = useCallback((delayMs = 0) => {
    clearPagerGestureScrollReleaseTimer()
    const release = () => {
      pagerGestureScrollReleaseTimer.current = null
      if (!persistentPagerGestureLockRef.current) setPagerGestureLocked?.(false)
    }
    if (delayMs <= 0) {
      release()
      return
    }
    pagerGestureScrollReleaseTimer.current = setTimeout(release, delayMs)
  }, [clearPagerGestureScrollReleaseTimer, setPagerGestureLocked])

  function commitMessageScrollViewport(nextViewport: MessageScrollViewport) {
    messageScrollViewportRef.current = nextViewport
    setMessageScrollViewport((current) => {
      const stableSize = Math.abs(current.contentHeight - nextViewport.contentHeight) < 8 && Math.abs(current.viewportHeight - nextViewport.viewportHeight) < 8
      if (
        stableSize &&
        current.awayFromBottom === nextViewport.awayFromBottom
      ) return current
      return nextViewport
    })
  }

  function buildMessageScrollViewport(contentHeight: number, viewportHeight: number, scrollY: number): MessageScrollViewport {
    const distanceFromBottom = Math.max(0, contentHeight - viewportHeight - scrollY)
    return {
      contentHeight,
      viewportHeight,
      scrollY,
      awayFromBottom: distanceFromBottom > USER_SCROLL_PAUSE_THRESHOLD,
    }
  }

  function collapseChrome() {
    if (chromeCollapseLocked || providerHealth?.code || testingHeader) return
    setShowOptions(false)
    setChromeCollapsed(true)
  }

  const clearPendingMessageScrolls = useCallback(() => {
    clearLatestMessageScrollTimers()
    clearLayoutScrollTimer()
  }, [clearLatestMessageScrollTimers, clearLayoutScrollTimer])

  useEffect(() => {
    setActiveActionMessageId(null)
    const emptyViewport = createEmptyMessageScrollViewport()
    messageScrollViewportRef.current = emptyViewport
    setMessageScrollViewport(emptyViewport)
    setShortConversationTopSpacer(0)
    userScrollInteractionActive.current = false
    userDragMomentumEligible.current = false
    if (userDragMomentumEligibilityTimer.current) {
      clearTimeout(userDragMomentumEligibilityTimer.current)
      userDragMomentumEligibilityTimer.current = null
    }
    clearPagerGestureScrollReleaseTimer()
    if (!persistentPagerGestureLockRef.current) setPagerGestureLocked?.(false)
    clearPendingMessageScrolls()
    autoStickToBottom.current = true
    lastScrollOffset.current = 0
    lastLayoutScrollAt.current = 0
  }, [activeConversation.id, clearPagerGestureScrollReleaseTimer, clearPendingMessageScrolls, setPagerGestureLocked])

  useEffect(() => {
    return () => {
      clearPendingMessageScrolls()
      if (userDragMomentumEligibilityTimer.current) clearTimeout(userDragMomentumEligibilityTimer.current)
      clearPagerGestureScrollReleaseTimer()
      if (!persistentPagerGestureLockRef.current) setPagerGestureLocked?.(false)
    }
  }, [clearPendingMessageScrolls, clearPagerGestureScrollReleaseTimer, setPagerGestureLocked])

  async function submit(content: string, attachments: Attachment[]) {
    scrollToLatestMessage(false, 0, { force: true, replacePending: true })
    try {
      await sendMessage({ conversation: activeConversation, content, attachments, requestedOutput: composerOutputMode })
    } catch (error) {
      dialog.toast({ title: t('chat.sendFailed'), message: error instanceof Error ? error.message : t('chat.sendFailedMessage'), tone: 'danger' })
      throw error
    }
  }

  function rememberCommandReference(reference: CommandReference) {
    const existing = activeConversation.commandRefs ?? []
    if (existing.some((item) => item.type === reference.type && item.id === reference.id)) return
    updateConversation(activeConversation.id, { commandRefs: [reference, ...existing].slice(0, 12) })
  }

  async function submitWhileStreaming(content: string, attachments: Attachment[]) {
    setIntentDraft({ content, attachments, requestedOutput: composerOutputMode })
  }

  function cancelStreamingIntent() {
    if (!intentDraft) return
    onApplyStarter(intentDraft.content, intentDraft.attachments, true)
    setIntentDraft(null)
  }

  async function applyStreamingIntent(intent: StreamingInputIntent) {
    if (!intentDraft) return
    const draft = intentDraft
    setIntentDraft(null)
    if (intent === 'interrupt') {
      scrollToLatestMessage(false, 0, { force: true, replacePending: true })
      safeStopMessage(activeConversation.id)
      setPendingStreamingMessage(null)
      setTimeout(() => {
        const latestConversation = useChatStore.getState().conversations.find((item) => item.id === activeConversation.id)
        if (!latestConversation) {
          onApplyStarter(draft.content, draft.attachments, true)
          dialog.toast({ title: t('chat.sendFailed'), message: t('chat.interruptedSendFailedMessage'), tone: 'danger' })
          return
        }
        if (latestConversation) {
          void sendMessage({ conversation: latestConversation, content: draft.content, attachments: draft.attachments, requestedOutput: draft.requestedOutput })
            .catch((error) => {
              onApplyStarter(draft.content, draft.attachments, true)
              dialog.toast({ title: t('chat.sendFailed'), message: error instanceof Error ? error.message : t('chat.interruptedSendFailedMessage'), tone: 'danger' })
            })
        }
      }, 30)
      return
    }
    scrollToLatestMessage(false, 0, { force: true, replacePending: true })
    setPendingStreamingMessage({ intent, content: draft.content, attachments: draft.attachments, requestedOutput: draft.requestedOutput })
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
    if (activeActionMessageId) setActiveActionMessageId(null)
    const y = event.nativeEvent.contentOffset.y
    const delta = y - lastScrollOffset.current
    const viewportHeight = event.nativeEvent.layoutMeasurement.height
    const contentHeight = event.nativeEvent.contentSize.height
    const distanceFromBottom = Math.max(
      0,
      contentHeight - viewportHeight - y
    )
    const awayFromBottom = distanceFromBottom > USER_SCROLL_PAUSE_THRESHOLD
    commitMessageScrollViewport({ contentHeight, viewportHeight, scrollY: y, awayFromBottom })
    if (distanceFromBottom <= USER_SCROLL_PAUSE_THRESHOLD) {
      autoStickToBottom.current = true
    } else if (userScrollInteractionActive.current || Math.abs(delta) > 4) {
      autoStickToBottom.current = false
    }
    if (delta < -10 && chromeCollapsed) {
      markChromeActive()
    } else if (delta > 8 && !chromeCollapsed) {
      collapseChrome()
    }
    lastScrollOffset.current = y
  }

  function handleListTouchStart() {
    lockPagerGestureForMessageScroll()
  }

  function handleListTouchEnd() {
    if (userScrollInteractionActive.current || userDragMomentumEligible.current) return
    releasePagerGestureAfterMessageScroll(MESSAGE_LIST_TOUCH_PAGER_GESTURE_RELEASE_DELAY_MS)
  }

  function handleListScrollBeginDrag() {
    lockPagerGestureForMessageScroll()
    if (userDragMomentumEligibilityTimer.current) {
      clearTimeout(userDragMomentumEligibilityTimer.current)
      userDragMomentumEligibilityTimer.current = null
    }
    userScrollInteractionActive.current = true
    userDragMomentumEligible.current = true
    autoStickToBottom.current = false
    clearPendingMessageScrolls()
  }

  function restoreAutoStickIfNearBottom() {
    if (!messageScrollViewportRef.current.awayFromBottom) autoStickToBottom.current = true
  }

  function handleListScrollEndDrag() {
    userScrollInteractionActive.current = false
    restoreAutoStickIfNearBottom()
    if (userDragMomentumEligibilityTimer.current) clearTimeout(userDragMomentumEligibilityTimer.current)
    userDragMomentumEligibilityTimer.current = setTimeout(() => {
      userDragMomentumEligible.current = false
      userDragMomentumEligibilityTimer.current = null
    }, MESSAGE_LIST_MOMENTUM_ELIGIBILITY_MS)
    releasePagerGestureAfterMessageScroll(MESSAGE_LIST_MOMENTUM_ELIGIBILITY_MS + 40)
  }

  function handleListMomentumScrollBegin() {
    if (!userDragMomentumEligible.current) return
    lockPagerGestureForMessageScroll()
    if (userDragMomentumEligibilityTimer.current) {
      clearTimeout(userDragMomentumEligibilityTimer.current)
      userDragMomentumEligibilityTimer.current = null
    }
    userScrollInteractionActive.current = true
    autoStickToBottom.current = false
    clearPendingMessageScrolls()
  }

  function handleListMomentumScrollEnd() {
    userScrollInteractionActive.current = false
    userDragMomentumEligible.current = false
    if (userDragMomentumEligibilityTimer.current) {
      clearTimeout(userDragMomentumEligibilityTimer.current)
      userDragMomentumEligibilityTimer.current = null
    }
    restoreAutoStickIfNearBottom()
    releasePagerGestureAfterMessageScroll()
  }

  function handleListLayout(event: LayoutChangeEvent) {
    const viewportHeight = Math.ceil(event.nativeEvent.layout.height)
    const currentViewport = messageScrollViewportRef.current
    commitMessageScrollViewport(buildMessageScrollViewport(currentViewport.contentHeight, viewportHeight, currentViewport.scrollY))
    updateShortConversationTopSpacer(viewportHeight, currentViewport.contentHeight)
    if (shouldAutoFollowLatestMessage()) requestMessageLayoutScroll()
  }

  function handleListContentSizeChange(_width: number, contentHeight: number) {
    const measuredContentHeight = Math.ceil(contentHeight)
    const currentViewport = messageScrollViewportRef.current
    commitMessageScrollViewport(buildMessageScrollViewport(measuredContentHeight, currentViewport.viewportHeight, currentViewport.scrollY))
    updateShortConversationTopSpacer(currentViewport.viewportHeight, measuredContentHeight)
    if (shouldAutoFollowLatestMessage()) requestMessageLayoutScroll()
  }

  function updateShortConversationTopSpacer(viewportHeight: number, measuredContentHeight: number) {
    if (!activeConversation.messages.length || viewportHeight <= 0 || measuredContentHeight <= 0) {
      setShortConversationTopSpacer((current) => current === 0 ? current : 0)
      return
    }
    setShortConversationTopSpacer((current) => {
      const baseContentHeight = Math.max(0, measuredContentHeight - current)
      const next = Math.max(0, Math.ceil(viewportHeight - baseContentHeight))
      return Math.abs(next - current) < 2 ? current : next
    })
  }

  function closeOptionsFromBackground() {
    if (showOptions) setShowOptions(false)
    if (composerPanel) setComposerPanel(null)
  }

  const scrollToLatestMessage = useCallback((animated = true, delay = 80, options?: { replacePending?: boolean; force?: boolean }) => {
    const force = options?.force === true
    if (force) {
      autoStickToBottom.current = true
    } else if (!shouldAutoFollowLatestMessage()) {
      return
    }
    if (options?.replacePending) {
      clearLatestMessageScrollTimers()
      clearLayoutScrollTimer()
    }
    const scroll = () => {
      if (!force && !shouldAutoFollowLatestMessage()) return
      listRef.current?.scrollToEnd({ animated })
    }
    if (delay <= 0) {
      scroll()
      return
    }
    const timer = setTimeout(() => {
      latestMessageScrollTimers.current.delete(timer)
      scroll()
    }, delay)
    latestMessageScrollTimers.current.add(timer)
  }, [autoStickToBottom, clearLatestMessageScrollTimers, clearLayoutScrollTimer, listRef, shouldAutoFollowLatestMessage])

  const requestMessageLayoutScroll = useCallback(() => {
    if (!shouldAutoFollowLatestMessage()) return
    const now = Date.now()
    const wait = Math.max(0, AUTO_SCROLL_DELAY_MS - (now - lastLayoutScrollAt.current))
    if (wait === 0) {
      clearLayoutScrollTimer()
      lastLayoutScrollAt.current = now
      listRef.current?.scrollToEnd({ animated: false })
      return
    }
    clearLayoutScrollTimer()
    layoutScrollTimer.current = setTimeout(() => {
      layoutScrollTimer.current = null
      if (!shouldAutoFollowLatestMessage()) return
      lastLayoutScrollAt.current = Date.now()
      listRef.current?.scrollToEnd({ animated: false })
    }, wait)
  }, [clearLayoutScrollTimer, listRef, shouldAutoFollowLatestMessage])

  useEffect(() => {
    requestMessageLayoutScroll()
  }, [messageListBottomPadding, requestMessageLayoutScroll])

  useEffect(() => {
    scrollToLatestMessage(false, 120, { force: true, replacePending: true })
    scrollToLatestMessage(false, 360, { force: true })
  }, [activeConversation.id, scrollToLatestMessage])

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
            visualTopInset={visualTopInset}
            collapsed={chromeCollapsed}
            streaming={isStreaming}
            showOptions={showOptions}
            mobileViewport={mobileViewport}
            conversation={activeConversation}
            provider={provider}
            providerHealth={providerHealth}
            metrics={metrics}
            onBack={() => (showBack ? router.back() : goHistory())}
            onRestore={restoreChrome}
            onCollapse={collapseChrome}
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
            optionsPanelKeyboardInset={optionsPanelKeyboardInset}
            onLayoutHeight={setChromeHeight}
            motion={motion}
            settings={settings}
            settingsTransitionActive={settingsTransitionActive}
          />

          <View onTouchStart={closeOptionsFromBackground} style={{ flex: 1, paddingTop: messageListTopInset }}>
            <FlashList
              ref={listRef}
              style={{ flex: 1 }}
              data={activeConversation.messages}
              keyExtractor={(item) => item.id}
              accessibilityRole="list"
              accessibilityLabel={t('chat.messageListAccessibilityLabel')}
              accessibilityValue={{ text: messageListAccessibilityValue }}
              accessibilityState={messageListAccessibilityState}
              keyboardShouldPersistTaps="handled"
              onLayout={handleListLayout}
              onContentSizeChange={handleListContentSizeChange}
              onTouchStart={handleListTouchStart}
              onTouchEnd={handleListTouchEnd}
              onTouchCancel={handleListTouchEnd}
              onScroll={handleListScroll}
              onScrollBeginDrag={handleListScrollBeginDrag}
              onScrollEndDrag={handleListScrollEndDrag}
              onMomentumScrollBegin={handleListMomentumScrollBegin}
              onMomentumScrollEnd={handleListMomentumScrollEnd}
              maintainVisibleContentPosition={messageListMaintainVisibleContentPosition}
              scrollEventThrottle={Platform.OS === 'android' ? 32 : 16}
              drawDistance={Platform.OS === 'android' ? 420 : undefined}
              maxItemsInRecyclePool={Platform.OS === 'android' ? 18 : undefined}
              getItemType={getMessageItemType}
              contentContainerStyle={{ paddingLeft: 20, paddingRight: messageListRightPadding, paddingTop: 8, paddingBottom: messageListBottomPadding }}
              ListHeaderComponent={activeConversation.messages.length ? renderConversationHeaderSpacer(conversationHeaderTopPadding) : null}
              renderItem={({ item: message, index }) => (
                <MessageBubble
                  key={message.id}
                  conversationId={activeConversation.id}
                  message={message}
                  index={index}
                  motion={messageListMotion}
                  viewportHeight={viewportHeight}
                  isLastAssistant={message.id === regenerableAssistantId}
                  activeActionMessageId={activeActionMessageId}
                  onActionMessageChange={setActiveActionMessageId}
                  onLayoutChangeRequest={requestMessageLayoutScroll}
                  onCopy={(item) => {
                    void copyMessageFinalText(item)
                      .then(() => dialog.toast({ title: t('common.copied'), message: t('chat.messageCopied'), tone: 'mint' }))
                      .catch(() => dialog.toast({ title: t('common.copyFailed'), message: t('chat.clipboardUnavailable'), tone: 'danger' }))
                  }}
                  onCopyProcessTrace={(item) => {
                    const traceText = collectVisibleProcessTraces(item).map(formatProcessTraceForCopy).filter(Boolean).join('\n\n')
                    if (!traceText.trim()) {
                      dialog.toast({ title: t('messageBubble.copyProcessTraceEmpty'), tone: 'amber' })
                      return
                    }
                    void Clipboard.setStringAsync(traceText)
                      .then(() => dialog.toast({ title: t('common.copied'), message: t('messageBubble.copyProcessTraceCopied'), tone: 'mint' }))
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
                    const traceFollowUpPrompt = readCompletedWorkArtifactTraceFollowUpPrompt(item)
                    const bodyFollowUpPrompt = readValidatedWorkArtifactBodyFollowUpPrompt(item)
                    const continuePrompt = traceFollowUpPrompt || bodyFollowUpPrompt
                    if (!continuePrompt) {
                      dialog.toast({ title: t('messageBubble.copyWorkArtifactEmpty'), tone: 'amber' })
                      return
                    }
                    onApplyStarter(continuePrompt)
                    dialog.toast({ title: t('messageBubble.continueWorkArtifactInserted'), tone: 'mint' })
                  }}
                  onContinueAgentWorkflow={(item) => {
                    const pendingAction = getAgentPendingActionFromMessage(item)
                    const continuationAction = getAgentWorkflowContinuationActionFromMessage(item)
                    const continuePrompt = safeAgentWorkflowStarterPrompt(pendingAction?.suggestedUserPrompt) ||
                      safeAgentWorkflowStarterPrompt(continuationAction?.suggestedUserPrompt) ||
                      safeAgentWorkflowStarterPrompt(t('messageBubble.continueAgentWorkflowPrompt', {
                      result: boundedAgentWorkflowResult(item) || t('messageBubble.emptyResponse'),
                    }))
                    onApplyStarter(continuePrompt)
                    dialog.toast({ title: t('messageBubble.continueAgentWorkflowInserted'), tone: 'mint' })
                  }}
                  onRepairAgentEvidence={(item) => {
                    const pendingAction = getAgentPendingActionFromMessage(item)
                    const repairAction = getAgentEvidenceRepairActionFromMessage(item)
                    const repairPrompt = safeAgentWorkflowStarterPrompt(pendingAction?.suggestedUserPrompt) ||
                      safeAgentWorkflowStarterPrompt(repairAction?.suggestedUserPrompt) ||
                      safeAgentWorkflowStarterPrompt(t('messageBubble.repairAgentEvidencePrompt', {
                      result: boundedAgentWorkflowResult(item) || t('messageBubble.emptyResponse'),
                    }))
                    onApplyStarter(repairPrompt)
                    dialog.toast({ title: t('messageBubble.repairAgentEvidenceInserted'), tone: 'mint' })
                  }}
                  onConfirmAgentAction={(item) => {
                    void confirmAgentAction(activeConversation.id, item.id)
                      .then((confirmed) => {
                        dialog.toast({
                          title: confirmed ? t('messageBubble.confirmAgentActionQueued') : t('messageBubble.confirmAgentActionUnavailable'),
                          tone: confirmed ? 'mint' : 'amber',
                        })
                      })
                      .catch((error) => dialog.toast({
                        title: t('messageBubble.confirmAgentActionFailed'),
                        message: error instanceof Error ? error.message : t('messageBubble.confirmAgentActionFailedMessage'),
                        tone: 'danger',
                      }))
                  }}
                  onPrepareAndroidUndo={(item) => {
                    const undoPrompt = t('messageBubble.prepareAndroidUndoPrompt', {
                      context: buildAndroidUndoPromptContext(item, t),
                    })
                    onApplyStarter(undoPrompt)
                    dialog.toast({ title: t('messageBubble.prepareAndroidUndoInserted'), tone: 'mint' })
                  }}
                  onSaveAgentWorkflow={(item) => {
                    const confirmOptions = buildAgentWorkflowSaveConfirmOptions(item, t)
                    void dialog.confirm({
                      title: t('messageBubble.saveAgentWorkflowTitle'),
                      message: confirmOptions.message,
                      confirmLabel: t('messageBubble.saveAgentWorkflow'),
                      cancelLabel: t('common.cancel'),
                      tone: 'mint',
                      chips: confirmOptions.chips,
                      metrics: confirmOptions.metrics,
                    }).then((confirmed) => {
                      if (!confirmed) return
                      return saveAgentWorkflowSkillFromMessage(activeConversation.id, item.id)
                        .then(async (result) => {
                          if (result.ok) await refreshSkills()
                          dialog.toast({
                            title: result.ok
                              ? result.status === 'already_saved'
                                ? t('messageBubble.saveAgentWorkflowAlreadySaved')
                                : t('messageBubble.saveAgentWorkflowSaved')
                              : t('messageBubble.saveAgentWorkflowUnavailable'),
                            message: result.ok ? result.skillName : result.reason,
                            tone: result.ok ? 'mint' : 'amber',
                          })
                        })
                    }).catch((error) => dialog.toast({
                      title: t('messageBubble.saveAgentWorkflowFailed'),
                      message: error instanceof Error ? error.message : t('messageBubble.saveAgentWorkflowFailedMessage'),
                      tone: 'danger',
                    }))
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
                  onConfigure={openAgentWorkflowSettings}
                  onTestModel={(item) => void testCurrentModel(item)}
                />
              )}
              ListEmptyComponent={(
                <EmptyConversationState
                  conversation={activeConversation}
                  provider={provider}
                  readyProviders={readyProviders}
                  settings={settings}
                  onHistory={goHistory}
                  onProviders={goProviders}
                  onSwitchProviderModel={confirmSwitchModel}
                  topPadding={emptyConversationTopPadding}
                />
              )}
            />
          </View>

          {intentDraft ? (
            <StreamingIntentSheet
              draft={intentDraft}
              insets={insets}
              onCancel={cancelStreamingIntent}
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
            initialAttachments={initialAttachments}
            restoreInitialDraftIfEmpty={restoreInitialDraftIfEmpty}
            commands={composerCommands}
            references={composerReferences}
            reasoningEffort={reasoningEffort}
            provider={provider}
            modelProviders={readyProviders}
            conversation={activeConversation}
            requestedOutput={composerOutputMode}
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
            onToggleRequestedOutput={onToggleComposerOutputMode}
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
              scrollToLatestMessage(false, 0, { replacePending: true })
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
  const backgroundMode = Platform.OS === 'android' ? 'none' : 'focus'

  return (
    <IsleScreen padded={false} background={backgroundMode} backgroundState={backgroundState} backgroundIntensity={compactViewport ? 0.84 : 1}>
      {children}
    </IsleScreen>
  )
}

function FloatingChrome({
  colors,
  insets,
  visualTopInset,
  collapsed,
  streaming,
  showOptions,
  mobileViewport,
  conversation,
  provider,
  providerHealth,
  metrics,
  onBack,
  onRestore,
  onCollapse,
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
  optionsPanelKeyboardInset,
  onLayoutHeight,
  motion,
  settings,
  settingsTransitionActive,
}: {
  colors: ReturnType<typeof useAppTheme>['colors']
  insets: ReturnType<typeof useSafeAreaInsets>
  visualTopInset: number
  collapsed: boolean
  streaming: boolean
  showOptions: boolean
  mobileViewport: boolean
  conversation: Conversation
  provider: AIProvider | undefined
  providerHealth: ConversationHealth | null
  metrics: ConversationMetrics
  onBack: () => void
  onRestore: () => void
  onCollapse: () => void
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
  optionsPanelKeyboardInset: number
  onLayoutHeight: (height: number) => void
  motion: ReturnType<typeof useMotionPreference>
  settings: ReturnType<typeof useSettingsStore.getState>['settings']
  settingsTransitionActive: boolean
}) {
  const { t } = useTranslation()
  const chromeSwipeStartY = useRef<number | null>(null)
  const chromeSwipeCollapsed = useRef(false)
  const header = getProviderHeaderState(conversation, provider, switchableProviders, metrics, providerHealth, settings, t)
  const modelLabel = conversation.providerId === 'local-setup' ? t('chat.localSetupGuide') : getProviderDisplayModel(provider, conversation.model)
  const collapsedPeekVisible = collapsed && (!mobileViewport || streaming)
  const subtitleLabel = providerHealth?.code
    ? modelLabel
    : provider?.enabled && provider.lastTestStatus !== 'ok'
      ? `${t('chat.providerEnabledNeedsCheck')} · ${modelLabel}`
      : modelLabel
  const chromeTopPadding = visualTopInset + FLOATING_CHROME_SAFE_AREA_GAP
  const chromeIconStyle: ViewStyle = {
    width: 44,
    height: 44,
    minHeight: 44,
    borderRadius: colors.ui.radius.controlMiddle,
    backgroundColor: 'transparent',
    borderWidth: 0,
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  }
  const activeChromeIconStyle: ViewStyle = {
    ...chromeIconStyle,
    backgroundColor: colors.ui.card.mutedBackground,
    borderWidth: 1,
    borderColor: colors.material.stroke,
  }
  const shellStyle: StyleProp<ViewStyle> = [
    {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: showOptions ? 70 : 40,
    },
  ]
  function handleLayout(event: LayoutChangeEvent) {
    onLayoutHeight(Math.ceil(event.nativeEvent.layout.height) + chromeTopPadding + FLOATING_CHROME_BOTTOM_PADDING + FLOATING_CHROME_ANDROID_TOP_GAP)
  }

  function handleChromeTouchStart(event: GestureResponderEvent) {
    if (collapsed) return
    chromeSwipeStartY.current = event.nativeEvent.pageY
    chromeSwipeCollapsed.current = false
  }

  function handleChromeTouchMove(event: GestureResponderEvent) {
    if (collapsed || chromeSwipeCollapsed.current || chromeSwipeStartY.current === null) return
    const distance = chromeSwipeStartY.current - event.nativeEvent.pageY
    if (distance < FLOATING_CHROME_SWIPE_COLLAPSE_DISTANCE) return
    chromeSwipeCollapsed.current = true
    onCollapse()
  }

  function clearChromeTouch() {
    chromeSwipeStartY.current = null
    chromeSwipeCollapsed.current = false
  }

  return (
    <View pointerEvents="box-none" style={shellStyle}>
      <MotiView
        pointerEvents={collapsed ? 'none' : 'auto'}
        animate={{ opacity: collapsed ? 0 : 1, translateY: collapsed ? -(visualTopInset + 78) : 0 }}
        transition={{ type: 'timing', duration: collapsed ? 150 : 210 }}
        onTouchStart={handleChromeTouchStart}
        onTouchMove={handleChromeTouchMove}
        onTouchEnd={clearChromeTouch}
        onTouchCancel={clearChromeTouch}
        style={{ marginTop: FLOATING_CHROME_ANDROID_TOP_GAP, paddingTop: chromeTopPadding, paddingHorizontal: 12, paddingBottom: FLOATING_CHROME_BOTTOM_PADDING, zIndex: 1 }}
      >
        <MotiView
          from={{ opacity: 0, translateY: -8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', damping: 22, stiffness: 190 }}
        >
          <View onLayout={handleLayout}>
            <View
              style={{
                minHeight: 54,
                paddingHorizontal: 8,
                paddingVertical: 5,
                justifyContent: 'center',
                backgroundColor: colors.material.glass,
                borderRadius: colors.ui.radius.controlLarge,
                borderWidth: 1,
                borderColor: colors.material.stroke,
                shadowColor: colors.shadowTint,
                shadowOpacity: Math.min(colors.ui.card.shadowOpacity, 0.14),
                shadowRadius: colors.ui.card.shadowRadius,
                shadowOffset: { width: 0, height: colors.ui.card.shadowOffset },
                elevation: colors.ui.card.shadowOpacity > 0 ? 2 : 0,
              }}
            >
              <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ width: 44, flexShrink: 0, alignItems: 'flex-start' }}>
                  <AnimatedNavigationTrigger variant="iconButton" label={t('common.back')} glyph={showOptions ? 'back' : 'history'} onNavigate={onBack} color={colors.text} style={chromeIconStyle} />
                </View>
                <View style={{ flex: 1, minWidth: 0, justifyContent: 'center', overflow: 'hidden', paddingHorizontal: 2 }}>
                  <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: colors.text, fontSize: 16, lineHeight: 21, fontWeight: '900', letterSpacing: 0, includeFontPadding: false, textAlignVertical: 'center' }}>
                    {header.title}
                  </Text>
                  {subtitleLabel ? (
                    <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 15, fontWeight: '700', marginTop: 1, includeFontPadding: false }}>
                      {subtitleLabel}
                    </Text>
                  ) : null}
                </View>
                <View style={{ width: 92, flexShrink: 0, flexDirection: 'row', justifyContent: 'flex-end', gap: 4 }}>
                  <IsleIconButton label={t('chat.conversationOptions')} onPress={onToggleOptions} tone="default" style={showOptions ? activeChromeIconStyle : chromeIconStyle}>
                    <ListEnd color={showOptions ? colors.ui.control.primaryForeground : colors.textSecondary} size={17} strokeWidth={2} />
                  </IsleIconButton>
                  <AnimatedNavigationTrigger variant="iconButton" label={t('settings.title')} glyph="settings-sliders" onNavigate={onSettings} externalActive={settingsTransitionActive} color={colors.text} style={settingsTransitionActive ? activeChromeIconStyle : chromeIconStyle} />
                </View>
              </View>
            </View>

            {providerHealth?.code ? (
              <View style={{ paddingTop: 8 }}>
                <ConversationHealthBanner
                  health={providerHealth}
                  testing={testingHeader}
                  onConfigure={onSettings}
                  onTest={onTestModel}
                  onSwitch={onToggleOptions}
                  compact
                />
              </View>
            ) : null}
          </View>

          {showOptions && optionsPanelPlacement === 'popover' ? (
            <MotiView
              from={motion === 'full' ? { opacity: 0, translateY: -8, scale: 0.985 } : { opacity: 0 }}
              animate={{ opacity: 1, translateY: 0, scale: 1 }}
              transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.settle } : { type: 'timing', duration: motionTokens.duration.fast }}
              style={optionsPanelOverlayStyle(optionsPanelPlacement, visualTopInset, insets.bottom, optionsPanelKeyboardInset)}
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
          style={optionsPanelOverlayStyle(optionsPanelPlacement, visualTopInset, insets.bottom, optionsPanelKeyboardInset)}
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
      {collapsedPeekVisible ? (
        <MotiView
          from={{ opacity: 0, translateY: -8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', damping: 20, stiffness: 180 }}
          style={{ position: 'absolute', top: visualTopInset + COLLAPSED_CHROME_TOP_OFFSET + FLOATING_CHROME_ANDROID_TOP_GAP, left: 0, right: 0, alignItems: 'center', zIndex: 80, elevation: 24 }}
          pointerEvents="box-none"
        >
          <IsleOverlayPressable
            onPress={onRestore}
            accessibilityRole="button"
            accessibilityLabel={streaming ? t('chat.generatingShowTopBar') : t('chat.showTopBar')}
            accessibilityHint={t('chat.showTopBarAccessibilityHint')}
            accessibilityState={streaming ? { busy: true } : undefined}
            hitSlop={12}
            style={{ minWidth: streaming ? 136 : 96, minHeight: 44, borderRadius: colors.ui.radius.chip, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.material.glass, borderWidth: 1, borderColor: colors.material.stroke, elevation: 24 }}
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
  initialAttachments,
  restoreInitialDraftIfEmpty,
  commands,
  references,
  reasoningEffort,
  provider,
  modelProviders,
  conversation,
  requestedOutput,
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
  onToggleRequestedOutput,
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
  initialAttachments?: Attachment[]
  restoreInitialDraftIfEmpty?: boolean
  commands: ComposerCommand[]
  references: CommandReference[]
  reasoningEffort: NonNullable<Conversation['reasoningEffort']>
  provider: AIProvider | undefined
  modelProviders: AIProvider[]
  conversation: Conversation
  requestedOutput: AgentRequestedOutput
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
  onToggleRequestedOutput: () => void
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
  const { width: composerWindowWidth } = useWindowDimensions()
  const modelOpen = panel === 'model'
  const reasoningOpen = panel === 'reasoning'
  const promptOpen = panel === 'prompt'
  const toolsOpen = panel === 'more'
  const reasoningOptions = useMemo(() => {
    const reasoningModel = provider ? resolveProviderModelAlias(provider, conversation.model) : conversation.model
    return getReasoningEffortOptions(provider, reasoningModel)
  }, [conversation.model, provider])
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
  const reasoningAvailable = showReasoning && reasoningOptions.length > 0
  const modelStatusLabel = provider ? getProviderDisplayModel(provider, conversation.model) : t('chat.quickModelUnset')
  const reasoningStatusLabel = reasoningAvailable ? t(`chat.reasoningEffort.${reasoningEffort}`) : t('chat.quickReasoningUnsupported')
  const promptStatusLabel = systemPrompt.trim() ? t('chat.quickPromptActive') : t('chat.quickPromptEmpty')
  const toolsStatusLabel = toolsOpen ? t('chat.quickToolsOpen') : t('chat.quickToolsReady')
  const outputStatusLabel = requestedOutput === 'work-artifact' ? t('chat.quickOutputWorkArtifact') : t('chat.quickOutputAuto')
  const outputActive = requestedOutput === 'work-artifact'
  const quickMenuOpen = !toolsCollapsed
  const quickToolMetrics = useMemo(() => {
    const usableWidth = Math.max(220, composerWindowWidth - 92)
    const secondaryWidth = Math.max(78, Math.min(96, usableWidth * 0.24))
    return {
      modelWidth: Math.max(86, Math.min(106, usableWidth * 0.28)),
      secondaryWidth,
      modelChoiceWidth: Math.max(164, Math.min(234, usableWidth * 0.72)),
    }
  }, [composerWindowWidth])

  useEffect(() => {
    const currentFamily = inferModelFamily(provider, conversation.model)
    setModelQuickGroup(currentFamily)
  }, [conversation.model, provider?.id])

  function handleInputFocus() {
    onCollapseTools()
    onInputFocus?.()
  }

  function handlePromptInputFocus() {
    onInteract?.()
  }

  function handleLayout(event: LayoutChangeEvent) {
    if (panel || !toolsCollapsed) return
    onLayoutHeight(Math.ceil(event.nativeEvent.layout.height))
  }

  const showQuickToolbar = quickMenuOpen || streaming || outputActive
  const renderQuickToolsToggle = () => (
    <ComposerToolButton
      label={toolsCollapsed ? t('chat.expandQuickTools') : t('chat.collapseQuickTools')}
      accessibilityHint={toolsCollapsed ? t('chat.expandQuickToolsAccessibilityHint') : t('chat.collapseQuickToolsAccessibilityHint')}
      accessibilityState={{ expanded: !toolsCollapsed }}
      active={!toolsCollapsed}
      iconOnly
      onPress={onToggleTools}
    >
      <MotiView
        animate={{ rotate: toolsCollapsed ? '0deg' : '-90deg', scale: toolsCollapsed ? 1 : 1.08 }}
        transition={motion === 'full' ? { type: 'spring', damping: 17, stiffness: 280 } : { type: 'timing', duration: 1 }}
      >
        <ChevronRight color={toolsCollapsed ? colors.textSecondary : colors.ui.control.primaryForeground} size={17} strokeWidth={2.3} />
      </MotiView>
    </ComposerToolButton>
  )
  const renderOutputModeButton = () => (
    <ComposerToolButton
      label={t('chat.quickOutput')}
      stateLabel={outputStatusLabel}
      accessibilityHint={t('chat.quickOutputAccessibilityHint')}
      accessibilityState={{ selected: outputActive }}
      active={outputActive}
      compact
      maxWidth={quickToolMetrics.secondaryWidth}
      onPress={onToggleRequestedOutput}
    >
      <ListEnd color={outputActive ? colors.ui.control.primaryForeground : colors.textSecondary} size={17} strokeWidth={2.1} />
    </ComposerToolButton>
  )

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: keyboardLift, zIndex: 40 }}>
      <KeyboardAvoidingView
        enabled={Platform.OS === 'ios'}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
        onTouchStart={onInteract}
        onTouchMove={onInteract}
        onTouchEnd={onInteractEnd}
        onTouchCancel={onInteractEnd}
      >
        <View onLayout={handleLayout} pointerEvents="box-none" style={{ paddingHorizontal: 14, paddingTop: 2, paddingBottom: Math.max(insets.bottom, 10) + 6 }}>
          {modelOpen ? (
            <MotiView
              from={{ opacity: 0, translateY: 4 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'spring', damping: 20, stiffness: 210 }}
              style={{ marginBottom: 5, borderRadius: colors.ui.radius.panel, padding: 10, backgroundColor: colors.ui.card.defaultBackground, borderWidth: 1, borderColor: colors.material.stroke }}
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
                      accessibilityHint={t('chat.quickModelFamilyAccessibilityHint', { family: t(`chat.modelFamilies.${group}`) })}
                      onPress={() => setModelQuickGroup(group)}
                    />
                  ))}
                  </View>
                ) : (
                  <View style={{ flex: 1 }} />
                )}
                <IslePressable
                  haptic
                  onPress={onOpenAdvancedModelPicker}
                  accessibilityRole="button"
                  accessibilityLabel={t('chat.advancedModelMenu')}
                  accessibilityHint={t('chat.advancedModelMenuAccessibilityHint')}
                  hitSlop={QUICK_TOOL_HIT_SLOP}
                  style={{ minHeight: 44, borderRadius: colors.ui.radius.chip, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.card.mutedBackground, borderWidth: 1, borderColor: colors.material.stroke }}
                >
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
                      maxWidth={quickToolMetrics.modelChoiceWidth}
                      accessibilityHint={t('chat.quickModelChoiceAccessibilityHint', { provider: option.provider.name, model: getProviderDisplayModel(option.provider, option.model) })}
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
          {reasoningOpen ? (
            <MotiView
              from={{ opacity: 0, translateY: 4 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'spring', damping: 20, stiffness: 210 }}
              style={{ flexDirection: 'row', gap: 7, marginBottom: 5, padding: 7, borderRadius: colors.ui.radius.field, backgroundColor: colors.ui.card.defaultBackground, borderWidth: 1, borderColor: colors.material.stroke }}
            >
              {reasoningAvailable ? reasoningOptions.map((effort) => (
                <IslePressable
                  key={effort}
                  haptic
                  onPress={() => {
                    onReasoningChange(effort)
                    onPanelChange(null)
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t('chat.reasoningChip', { value: t(`chat.reasoningEffort.${effort}`) })}
                  accessibilityHint={t('chat.reasoningEffortAccessibilityHint', { value: t(`chat.reasoningEffort.${effort}`) })}
                  accessibilityState={{ selected: reasoningEffort === effort }}
                  hitSlop={QUICK_TOOL_HIT_SLOP}
                  style={{ minHeight: 44, borderRadius: colors.ui.radius.chip, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: reasoningEffort === effort ? colors.ui.control.primaryBackground : colors.ui.card.mutedBackground, borderWidth: 1, borderColor: reasoningEffort === effort ? colors.ui.control.primaryBorder : colors.material.stroke }}
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
          {promptOpen ? (
            <MotiView
              from={{ opacity: 0, translateY: 4 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'spring', damping: 20, stiffness: 210 }}
              style={{ marginBottom: 5, borderRadius: colors.ui.radius.panel, padding: 10, backgroundColor: colors.ui.card.defaultBackground, borderWidth: 1, borderColor: colors.material.stroke }}
            >
              <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900', marginBottom: 6 }}>{t('chat.systemPrompt')}</Text>
              <TextInput
                value={systemPrompt}
                onChangeText={onSystemPromptChange}
                onFocus={handlePromptInputFocus}
                onBlur={onInputBlur}
                multiline
                placeholder={t('chat.systemPromptExample')}
                placeholderTextColor={colors.textTertiary}
                accessibilityLabel={t('chat.systemPrompt')}
                accessibilityHint={t('chat.systemPromptAccessibilityHint')}
                style={{ minHeight: 58, maxHeight: 112, borderRadius: colors.ui.radius.field, paddingHorizontal: 12, paddingVertical: 10, color: colors.text, backgroundColor: colors.ui.input.background, borderWidth: 1, borderColor: colors.ui.input.border, fontSize: 13, lineHeight: 19, textAlignVertical: 'top' }}
              />
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <IslePressable
                  haptic
                  onPress={() => onSystemPromptChange('')}
                  accessibilityRole="button"
                  accessibilityLabel={t('chat.clearSystemPrompt')}
                  accessibilityHint={t('chat.clearSystemPromptAccessibilityHint')}
                  hitSlop={QUICK_TOOL_HIT_SLOP}
                  style={{ minHeight: 44, borderRadius: colors.ui.radius.chip, paddingHorizontal: 12, justifyContent: 'center', backgroundColor: colors.ui.card.mutedBackground, borderWidth: 1, borderColor: colors.material.stroke }}
                >
                  <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900' }}>{t('chat.clearSystemPrompt')}</Text>
                </IslePressable>
                <IslePressable
                  haptic
                  onPress={() => onPanelChange(null)}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.done')}
                  accessibilityHint={t('chat.closeQuickPanelAccessibilityHint')}
                  hitSlop={QUICK_TOOL_HIT_SLOP}
                  style={{ minHeight: 44, borderRadius: colors.ui.radius.chip, paddingHorizontal: 12, justifyContent: 'center', backgroundColor: colors.ui.control.primaryBackground, borderWidth: 1, borderColor: colors.ui.control.primaryBorder }}
                >
                  <Text style={{ color: colors.ui.control.primaryForeground, fontSize: 11, fontWeight: '900' }}>{t('common.done')}</Text>
                </IslePressable>
              </View>
            </MotiView>
          ) : null}
          {showQuickToolbar ? (
          <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 9 }}>
            {renderQuickToolsToggle()}
            {outputActive && !quickMenuOpen ? renderOutputModeButton() : null}
            {quickMenuOpen ? (
              <View style={{ flex: 1, minHeight: 44 }}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  nestedScrollEnabled
                  onTouchStart={onInteract}
                  onTouchMove={onInteract}
                  onTouchEnd={onInteractEnd}
                  onTouchCancel={onInteractEnd}
                  contentContainerStyle={{ flexGrow: 1, alignItems: 'center', gap: 5, paddingLeft: 2, paddingRight: 0, paddingVertical: 1 }}
                >
                  <ComposerToolButton
                    label={t('chat.quickModel')}
                    stateLabel={modelStatusLabel}
                    accessibilityHint={t('chat.quickModelAccessibilityHint')}
                    accessibilityState={{ expanded: modelOpen }}
                    active={modelOpen}
                    compact
                    maxWidth={quickToolMetrics.modelWidth}
                    onPress={onOpenModelPicker}
                  >
                    <Bot color={modelOpen ? colors.ui.control.primaryForeground : colors.textSecondary} size={17} strokeWidth={2} />
                  </ComposerToolButton>
                  <ComposerToolButton
                    label={t('chat.quickReasoning')}
                    stateLabel={reasoningStatusLabel}
                    accessibilityHint={reasoningAvailable ? t('chat.quickReasoningAccessibilityHint') : t('chat.quickReasoningUnavailableAccessibilityHint')}
                    accessibilityState={{ expanded: reasoningOpen }}
                    active={reasoningOpen}
                    compact
                    maxWidth={quickToolMetrics.secondaryWidth}
                    onPress={onOpenReasoningPicker ?? (() => {
                      onPanelChange(reasoningOpen ? null : 'reasoning')
                    })}
                  >
                    <ReasoningToolIcon effort={reasoningEffort} active={reasoningOpen} available={reasoningAvailable} />
                  </ComposerToolButton>
                  <ComposerToolButton
                    label={t('chat.quickPrompt')}
                    stateLabel={promptStatusLabel}
                    accessibilityHint={t('chat.quickPromptAccessibilityHint')}
                    accessibilityState={{ expanded: promptOpen, selected: !!systemPrompt.trim() }}
                    active={promptOpen || !!systemPrompt.trim()}
                    compact
                    maxWidth={quickToolMetrics.secondaryWidth}
                    onPress={() => {
                      onPanelChange(promptOpen ? null : 'prompt')
                    }}
                  >
                    <FileText color={(promptOpen || systemPrompt.trim()) ? colors.ui.control.primaryForeground : colors.textSecondary} size={17} strokeWidth={2} />
                  </ComposerToolButton>
                  {renderOutputModeButton()}
                  <ComposerToolButton
                    label={t('chat.quickTools')}
                    stateLabel={toolsStatusLabel}
                    accessibilityHint={t('chat.quickToolsAccessibilityHint')}
                    accessibilityState={{ expanded: toolsOpen }}
                    active={toolsOpen}
                    compact
                    maxWidth={quickToolMetrics.secondaryWidth}
                    onPress={() => {
                      onPanelChange(toolsOpen ? null : 'more')
                    }}
                  >
                    <Wrench color={toolsOpen ? colors.ui.control.primaryForeground : colors.textSecondary} size={17} strokeWidth={2.1} />
                  </ComposerToolButton>
                </ScrollView>
              </View>
            ) : null}
            {streaming ? (
              <ComposerToolButton label={t('chat.stopGenerating')} accessibilityHint={t('chat.stopGeneratingAccessibilityHint')} accessibilityState={{ busy: true }} active onPress={onStop}>
                <Square color={colors.ui.control.primaryForeground} size={13} strokeWidth={2.3} fill={colors.ui.control.primaryForeground} />
              </ComposerToolButton>
            ) : null}
            {streaming ? <GenerationStatusPill label={activityLabel || t('chat.generating')} /> : null}
          </View>
          ) : null}
          <Composer
            disabled={disabled}
            streaming={streaming}
            pendingNotice={pendingNotice}
            initialDraft={initialDraft}
            initialDraftKey={initialDraftKey}
            initialAttachments={initialAttachments}
            restoreInitialDraftIfEmpty={restoreInitialDraftIfEmpty}
            commands={commands}
            references={references}
            utilitiesOpen={toolsOpen}
            showInlineUtilities={false}
            leadingAccessory={!showQuickToolbar ? renderQuickToolsToggle() : undefined}
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

function ComposerToolButton({
  label,
  stateLabel,
  accessibilityHint,
  accessibilityState,
  active,
  iconOnly = false,
  compact = false,
  maxWidth,
  children,
  onPress,
}: {
  label: string
  stateLabel?: string
  accessibilityHint?: string
  accessibilityState?: {
    disabled?: boolean
    selected?: boolean
    checked?: boolean | 'mixed'
    busy?: boolean
    expanded?: boolean
  }
  active: boolean
  iconOnly?: boolean
  compact?: boolean
  maxWidth?: number
  children: ReactNode
  onPress: () => void
}) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const controlRadius = colors.ui.radius.controlLarge
  const accessibilityLabel = stateLabel ? `${label}: ${stateLabel}` : label
  return (
    <IslePressable
      haptic
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={accessibilityState ?? (active ? { selected: true } : undefined)}
      hitSlop={QUICK_TOOL_HIT_SLOP}
      style={{ width: iconOnly ? 44 : undefined, flexGrow: iconOnly ? 0 : 1, flexShrink: iconOnly ? 0 : 1, flexBasis: iconOnly ? undefined : 0, maxWidth, minHeight: 44, borderRadius: controlRadius }}
    >
      <MotiView
        animate={{
          backgroundColor: active ? colors.ui.control.primaryBackground : colors.ui.card.mutedBackground,
          borderColor: active ? colors.ui.control.primaryBorder : colors.material.stroke,
          scale: active ? 1.035 : 1,
        }}
        transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.gentle } : { type: 'timing', duration: 1 }}
        style={{
          width: iconOnly ? 44 : '100%',
          maxWidth,
          minHeight: 44,
          borderRadius: controlRadius,
          paddingHorizontal: iconOnly ? 0 : compact ? 7 : stateLabel ? 10 : 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: iconOnly ? 0 : compact ? 4 : 7,
          borderWidth: 1,
        }}
      >
        {children}
        {iconOnly ? null : (
          <View style={{ minWidth: 0, flexShrink: 1, maxWidth: stateLabel ? (compact ? 54 : 82) : (compact ? 62 : 104) }}>
            <Text numberOfLines={1} style={{ color: active ? colors.ui.control.primaryForeground : colors.textSecondary, fontSize: compact ? 10.5 : 11, lineHeight: 14, fontWeight: '900', includeFontPadding: false, textAlignVertical: 'center' }}>{label}</Text>
            {stateLabel ? (
              <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: active ? colors.ui.control.primaryForeground : colors.textTertiary, fontSize: compact ? 9.5 : 10, lineHeight: 13, fontWeight: '800', includeFontPadding: false, textAlignVertical: 'center', opacity: active ? 0.82 : 1 }}>
                {stateLabel}
              </Text>
            ) : null}
          </View>
        )}
      </MotiView>
    </IslePressable>
  )
}

function ReasoningToolIcon({ effort, active, available }: { effort: NonNullable<Conversation['reasoningEffort']>; active: boolean; available: boolean }) {
  const { colors } = useAppTheme()
  const level = getReasoningVisualLevel(effort)
  const Icon = level >= 4 ? BrainCog : level >= 2 ? BrainCircuit : Brain
  const color = !available ? colors.textTertiary : active ? colors.ui.control.primaryForeground : level >= 4 ? colors.ui.icon.accentForeground : colors.textSecondary
  const showDot = available && level >= 2
  const showSpark = available && level >= 4

  return (
    <View style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}>
      <Icon color={color} size={17} strokeWidth={level >= 4 ? 2.25 : 2} />
      {showDot ? (
        <View style={{ position: 'absolute', right: level >= 4 ? 0 : 2, bottom: 1, width: level >= 3 ? 6 : 4, height: level >= 3 ? 6 : 4, borderRadius: 3, backgroundColor: color, opacity: level >= 3 ? 0.88 : 0.62 }} />
      ) : null}
      {showSpark ? (
        <Sparkles color={color} size={10} strokeWidth={2.2} style={{ position: 'absolute', right: -3, top: -3 }} />
      ) : null}
    </View>
  )
}

function getReasoningVisualLevel(effort: NonNullable<Conversation['reasoningEffort']>) {
  switch (effort) {
    case 'max':
    case 'xhigh':
      return 5
    case 'high':
      return 4
    case 'medium':
      return 3
    case 'low':
      return 2
    case 'minimal':
      return 1
    case 'none':
    default:
      return 0
  }
}

function QuickChoiceButton({ label, active, accessibilityHint, maxWidth, onPress }: { label: string; active: boolean; accessibilityHint?: string; maxWidth?: number; onPress: () => void }) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const textMaxWidth = maxWidth ? Math.max(24, maxWidth - 24) : undefined
  const activeBackground = colors.ui.control.primaryBackground
  const activeForeground = colors.ui.control.primaryForeground
  return (
    <IslePressable
      haptic
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected: active }}
      hitSlop={QUICK_TOOL_HIT_SLOP}
      style={{ maxWidth, minHeight: 44, borderRadius: colors.ui.radius.chip, alignItems: 'center', justifyContent: 'center' }}
    >
      <MotiView
        animate={{
          backgroundColor: active ? activeBackground : colors.ui.card.mutedBackground,
          borderColor: active ? colors.ui.control.primaryBorder : colors.material.stroke,
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
  const { width } = useWindowDimensions()
  const labelMaxWidth = Math.max(112, Math.min(160, width * 0.36))
  return (
    <View
      accessible
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      accessibilityRole="text"
      accessibilityState={{ busy: true }}
      style={{ minHeight: 44, borderRadius: colors.ui.radius.chip, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: colors.ui.card.defaultBackground, borderWidth: 1, borderColor: colors.material.stroke }}
    >
      <MotiView
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        from={{ opacity: 0.35, scale: 0.84 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ loop: true, type: 'timing', duration: 760 }}
        style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.ui.control.primaryBackground }}
      />
      <Text accessible={false} importantForAccessibility="no" numberOfLines={1} style={{ maxWidth: labelMaxWidth, color: colors.textSecondary, fontSize: 11, lineHeight: 15, fontWeight: '900', includeFontPadding: false, textAlignVertical: 'center' }}>
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
  const { width } = useWindowDimensions()
  const preview = previewPendingText(draft.content, draft.attachments, t)
  const compact = width < 390
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
              style={{ width: 44, height: 44, borderRadius: colors.ui.radius.controlLarge, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.card.mutedBackground, borderWidth: 1, borderColor: colors.material.stroke }}
            >
              <X color={colors.textTertiary} size={16} strokeWidth={2.1} />
            </IslePressable>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: compact ? 'wrap' : 'nowrap', gap: 8, marginTop: 11 }}>
            <IntentAction label={t('chat.intentGuide')} description={t('chat.intentGuideDescription')} onPress={() => onChoose('guide')}>
              <GitBranchPlus color={colors.ui.icon.accentForeground} size={16} strokeWidth={2.1} />
            </IntentAction>
            <IntentAction label={t('chat.intentQueue')} description={t('chat.intentQueueDescription')} onPress={() => onChoose('queue')}>
              <ListEnd color={colors.ui.icon.accentForeground} size={16} strokeWidth={2.1} />
            </IntentAction>
            <IntentAction label={t('chat.intentInterrupt')} description={t('chat.intentInterruptDescription')} danger onPress={() => onChoose('interrupt')}>
              <Split color={colors.ui.tone.danger.foreground} size={16} strokeWidth={2.1} />
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
        flexGrow: 1,
        flexShrink: 1,
        flexBasis: '31%',
        minWidth: 0,
        minHeight: 60,
        borderRadius: actionRadius,
        paddingHorizontal: 10,
        paddingVertical: 9,
        backgroundColor: danger ? colors.ui.tone.danger.background : colors.ui.card.defaultBackground,
        borderWidth: 1,
        borderColor: danger ? colors.ui.tone.danger.border : colors.material.stroke,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}>
        {children}
        <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: danger ? colors.ui.tone.danger.foreground : colors.text, fontSize: 13, fontWeight: '900' }}>{label}</Text>
      </View>
      <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '800', marginTop: 4 }}>
        {description}
      </Text>
    </IslePressable>
  )
}

function renderConversationHeaderSpacer(
  topPadding: number
) {
  return <View style={{ paddingTop: topPadding, marginBottom: 4 }} />
}

function getMessageItemType(message: Message) {
  if (message.status === 'streaming' || message.status === 'sending') return `${message.role}:active`
  return `${message.role}:static`
}

function SetupEmptyState({ description, actionLabel, actionHint, glyph, onAction }: { description: string; actionLabel: string; actionHint?: string; glyph: NavigationGlyph; onAction: () => void }) {
  const { colors } = useAppTheme()
  const { width } = useWindowDimensions()
  const navigation = useNavigationTrigger(onAction)
  const contentMaxWidth = Math.max(260, Math.min(330, width - 48))
  const actionMinWidth = Math.max(132, Math.min(148, contentMaxWidth * 0.46))
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: '100%', maxWidth: contentMaxWidth, alignItems: 'center', gap: 14 }}>
        <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 21, fontWeight: '800', textAlign: 'center' }}>
          {description}
        </Text>
        <IslePressable
          haptic
          onPress={navigation.trigger}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          accessibilityHint={actionHint}
          hitSlop={QUICK_START_ACTION_HIT_SLOP}
          style={{ minHeight: 48, minWidth: actionMinWidth, borderRadius: colors.ui.radius.controlLarge, paddingHorizontal: 18, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.control.primaryBackground, borderWidth: 1, borderColor: colors.ui.control.primaryBorder, shadowColor: colors.ui.control.shadow, shadowOpacity: colors.ui.control.primaryShadowOpacity, shadowRadius: colors.ui.control.primaryShadowRadius, shadowOffset: { width: 0, height: colors.ui.control.primaryShadowOffset } }}
        >
          <AnimatedNavigationIcon glyph={glyph} active={navigation.active} color={colors.ui.control.primaryForeground} size={18} />
          <Text numberOfLines={1} style={{ flexShrink: 1, color: colors.ui.control.primaryForeground, fontSize: 14, fontWeight: '900', includeFontPadding: false }}>{actionLabel}</Text>
        </IslePressable>
      </View>
    </View>
  )
}

function EmptyConversationState({
  conversation,
  provider,
  readyProviders,
  settings,
  onHistory,
  onProviders,
  onSwitchProviderModel,
  topPadding,
}: {
  conversation: Conversation
  provider: AIProvider | undefined
  readyProviders: AIProvider[]
  settings: ReturnType<typeof useSettingsStore.getState>['settings']
  onHistory: () => void
  onProviders: () => void
  onSwitchProviderModel: (provider: AIProvider, model: string) => void
  topPadding: number
}) {
  const { t } = useTranslation()
  const highlights = useMemo(
    () => buildHomeModelHighlights(conversation, provider, readyProviders, settings),
    [conversation.model, conversation.providerId, provider, readyProviders, settings]
  )
  return (
    <View style={{ paddingTop: topPadding, gap: 14 }}>
      <IsleEmptyState
        title={t('chat.newConversation')}
      />
      {highlights.length ? (
        <View style={{ width: '100%', alignItems: 'center', gap: 8 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 7, maxWidth: 360 }}>
            {highlights.map((item) => (
              <QuickStartModelChip
                key={item.id}
                label={getProviderDisplayModel(item.provider, item.model)}
                providerName={item.provider.name}
                active={item.selected}
                accessibilityHint={t('chat.quickModelChoiceAccessibilityHint', { provider: item.provider.name, model: getProviderDisplayModel(item.provider, item.model) })}
                onPress={() => onSwitchProviderModel(item.provider, item.model)}
              />
            ))}
          </View>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <QuickStartAction label={t('chat.configureProviders')} accessibilityHint={t('chat.configureProvidersAccessibilityHint')} glyph="provider-key" onPress={onProviders} />
        <QuickStartAction label={t('conversation.viewHistory')} accessibilityHint={t('conversation.viewHistoryAccessibilityHint')} glyph="history" onPress={onHistory} muted />
      </View>
    </View>
  )
}

function QuickStartModelChip({
  label,
  providerName,
  active,
  accessibilityHint,
  onPress,
}: {
  label: string
  providerName: string
  active: boolean
  accessibilityHint?: string
  onPress: () => void
}) {
  const { colors } = useAppTheme()
  const backgroundColor = active ? colors.ui.control.primaryBackground : colors.ui.card.defaultBackground
  const foregroundColor = active ? colors.ui.control.primaryForeground : colors.textSecondary
  const borderColor = active ? colors.ui.control.primaryBorder : colors.material.stroke
  return (
    <IslePressable
      haptic
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${providerName} ${label}`}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected: active }}
      hitSlop={QUICK_START_ACTION_HIT_SLOP}
      style={{
        maxWidth: 172,
        minHeight: 36,
        borderRadius: colors.ui.radius.chip,
        paddingHorizontal: 10,
        paddingVertical: 7,
        gap: 2,
        backgroundColor,
        borderWidth: 1,
        borderColor,
      }}
    >
      <Text numberOfLines={1} style={{ color: foregroundColor, fontSize: 11, lineHeight: 14, fontWeight: '900', includeFontPadding: false }}>
        {label}
      </Text>
      <Text numberOfLines={1} style={{ color: active ? colors.ui.control.primaryForeground : colors.textTertiary, opacity: active ? 0.78 : 1, fontSize: 9.5, lineHeight: 12, fontWeight: '800', includeFontPadding: false }}>
        {providerName}
      </Text>
    </IslePressable>
  )
}

function pushSettingsRoute(pathname: '/settings/providers' | '/settings/knowledge' | '/settings/skills', params?: Record<string, string>) {
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

function optionsPanelOverlayStyle(placement: ChatOptionsPlacement, topInset: number, bottomInset: number, keyboardInset = 0): ViewStyle {
  if (placement === 'sheet') {
    return {
      position: 'absolute',
      left: 12,
      right: 12,
      bottom: Math.max(12, bottomInset + 8) + keyboardInset,
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

function buildHomeModelHighlights(
  conversation: Conversation,
  provider: AIProvider | undefined,
  readyProviders: AIProvider[],
  settings?: ReturnType<typeof useSettingsStore.getState>['settings']
): HomeModelHighlight[] {
  const highlights: HomeModelHighlight[] = []
  const seen = new Set<string>()
  const push = (itemProvider: AIProvider | undefined, model: string | undefined) => {
    if (!itemProvider || !model) return
    const available = getPolicyAllowedProviderModels(itemProvider, settings)
    if (!available.includes(model)) return
    const id = `${itemProvider.id}:${model}`
    if (seen.has(id) || highlights.length >= HOME_MODEL_HIGHLIGHT_LIMIT) return
    seen.add(id)
    highlights.push({
      id,
      provider: itemProvider,
      model,
      family: inferModelFamily(itemProvider, model),
      selected: itemProvider.id === conversation.providerId && model === conversation.model,
    })
  }

  push(provider, conversation.model)
  if (provider) {
    push(provider, getPolicyPreferredProviderModel(provider, settings))
    for (const model of getPolicyAllowedProviderModels(provider, settings)) push(provider, model)
  }

  for (const readyProvider of readyProviders) {
    push(readyProvider, getPolicyPreferredProviderModel(readyProvider, settings))
  }

  return highlights
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

function QuickStartAction({ label, accessibilityHint, glyph, muted = false, onPress }: { label: string; accessibilityHint?: string; glyph: NavigationGlyph; muted?: boolean; onPress: () => void }) {
  const { colors } = useAppTheme()
  const backgroundColor = muted ? colors.ui.card.defaultBackground : colors.ui.control.primaryBackground
  const foregroundColor = muted ? colors.textSecondary : colors.ui.control.primaryForeground
  const borderColor = muted ? colors.material.stroke : colors.ui.control.primaryBorder
  const navigation = useNavigationTrigger(onPress)
  return (
    <IslePressable
      haptic
      onPress={navigation.trigger}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      hitSlop={QUICK_START_ACTION_HIT_SLOP}
      style={{
        minHeight: 44,
        maxWidth: '100%',
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
      <Text numberOfLines={1} style={{ flexShrink: 1, color: foregroundColor, fontSize: 12, fontWeight: '900', includeFontPadding: false }}>{label}</Text>
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
  const healthTone = health.inheritedExpired ? colors.ui.tone.danger : colors.ui.tone.warning
  const borderColor = healthTone.border
  if (compact) {
    return (
      <MotiView
        from={{ opacity: 0, translateY: -6, scale: 0.98 }}
        animate={{ opacity: 1, translateY: 0, scale: 1 }}
        transition={{ type: 'spring', damping: 20, stiffness: 180 }}
        style={{
          marginBottom: 8,
          borderRadius: colors.ui.radius.chip,
          padding: 4,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          backgroundColor: colors.ui.card.defaultBackground,
          borderWidth: 1,
          borderColor: colors.material.stroke,
        }}
      >
        <BannerAction label={t('chat.configure')} glyph="provider-key" onPress={onConfigure} compact />
        <BannerAction
          label={testing ? t('chat.testing') : t('chat.test')}
          onPress={onTest}
          compact
          disabled={testing || health.code === 'missing_key' || health.code === 'disabled_provider' || health.code === 'provider_missing'}
        />
        <BannerAction label={t('chat.switch')} onPress={onSwitch} compact />
      </MotiView>
    )
  }
  return (
    <MotiView
      from={{ opacity: 0, translateY: -8, scale: 0.98 }}
      animate={{ opacity: 1, translateY: 0, scale: 1 }}
      transition={{ type: 'spring', damping: 20, stiffness: 180 }}
      style={{
        marginHorizontal: 16,
        marginBottom: 8,
        borderRadius: colors.ui.radius.card,
        padding: 13,
        backgroundColor: colors.ui.card.defaultBackground,
        borderWidth: 1,
        borderColor,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ width: 34, height: 34, borderRadius: colors.ui.radius.controlMiddle, alignItems: 'center', justifyContent: 'center', backgroundColor: healthTone.background }}>
          <AlertTriangle color={healthTone.foreground} size={18} strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 14, fontWeight: '900' }}>{health.title}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 3 }}>{health.description}</Text>
          {health.inheritedExpired ? (
            <Text style={{ color: healthTone.foreground, fontSize: 11, lineHeight: 16, marginTop: 5 }}>
              {t('chat.chooseAvailableModel')}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        <BannerAction label={t('chat.configure')} glyph="provider-key" onPress={onConfigure} />
        <BannerAction
          label={testing ? t('chat.testing') : t('chat.testCurrentModel')}
          onPress={onTest}
          disabled={testing || health.code === 'missing_key' || health.code === 'disabled_provider' || health.code === 'provider_missing'}
        />
        <BannerAction label={t('chat.switchModel')} onPress={onSwitch} />
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
        backgroundColor: colors.ui.card.defaultBackground,
        borderWidth: 1,
        borderColor: colors.material.stroke,
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
      ? modelLabel
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
