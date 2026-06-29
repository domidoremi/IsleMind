import { useEffect } from 'react'
import { Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { ChatWorkspace, type RuntimeRepairIntent } from '@/components/chat/ChatWorkspace'
import { AnimatedNavigationTrigger } from '@/components/navigation/AnimatedNavigationTrigger'
import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import { IsleEmptyState } from '@/components/ui/isle'
import { IsleHeader } from '@/components/ui/isle'
import { IsleScreen } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useChatStore } from '@/store/chatStore'
import type { Conversation, Message, ProcessTrace } from '@/types'

interface RuntimeRepairChatParams {
  id?: string | string[]
  source?: string | string[]
  action?: string | string[]
  target?: string | string[]
  event?: string | string[]
  providerId?: string | string[]
  credentialGroupId?: string | string[]
  model?: string | string[]
  issueCodes?: string | string[]
  sourceEventIds?: string | string[]
  latestEventId?: string | string[]
  eventCount?: string | string[]
  severity?: string | string[]
  summary?: string | string[]
}

const RUNTIME_REPAIR_REPLAY_PAYLOAD_SCHEMA = 'islemind.runtime-repair.replay.v1'

interface RuntimeRepairReplayPayload {
  schema: typeof RUNTIME_REPAIR_REPLAY_PAYLOAD_SCHEMA
  conversationId: string
  action?: string
  target?: string
  event?: string
  severity?: string
  scope: string
  providerId?: string
  credentialGroupId?: string
  model?: string
  issueCodes: string[]
  eventCount: number
  latestEventId?: string
  sourceEventIds: string[]
  repairSteps: RuntimeRepairReplayStep[]
  summary?: string
  previousUserMessage?: string
  failureSummary?: string
}

interface RuntimeRepairReplayStep {
  id: string
  kind: string
  instruction: string
  target?: string
  action?: string
  requiredBeforeRetry: boolean
}

export default function ConversationDeepLinkScreen() {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const params = useLocalSearchParams() as RuntimeRepairChatParams
  const id = routeParamText(params.id)
  const conversations = useChatStore((state) => state.conversations)
  const select = useChatStore((state) => state.select)
  const conversation = conversations.find((item) => item.id === id) ?? null
  const runtimeRepairIntent = conversation ? buildRuntimeRepairIntent(params, conversation, t) : undefined

  useEffect(() => {
    if (conversation) select(conversation.id)
  }, [conversation, select])

  if (conversation) {
    return (
      <ChatWorkspace
        conversation={conversation}
        showBack
        initialDraft={runtimeRepairIntent?.prompt}
        initialDraftKey={runtimeRepairIntent?.key}
        restoreInitialDraftIfEmpty
        runtimeRepairIntent={runtimeRepairIntent}
      />
    )
  }

  return (
    <IsleScreen padded={false} background="focus">
      <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8 }}>
        <IsleHeader
          title={t('conversation.unavailable')}
          subtitle={id || t('conversation.missingId')}
          leading={
            <AnimatedNavigationTrigger variant="iconButton" label={t('common.back')} glyph="back" onNavigate={() => router.back()} color={colors.text} />
          }
        />
      </View>
      <View style={{ flex: 1, paddingHorizontal: 20, justifyContent: 'center' }}>
        <IsleEmptyState
          title={t('conversation.notFound')}
          actionLabel={t('conversation.viewHistory')}
          actionGlyph="history"
          onAction={() => router.push('/conversations')}
        />
        <View style={{ alignItems: 'center', marginTop: 12 }}>
          <AppIcon name="message" color={colors.textTertiary} size={22} strokeWidth={appIconStroke.fine} />
        </View>
      </View>
    </IsleScreen>
  )
}

function buildRuntimeRepairIntent(
  params: RuntimeRepairChatParams,
  conversation: Conversation,
  t: ReturnType<typeof useTranslation>['t'],
): RuntimeRepairIntent | undefined {
  if (routeParamText(params.source) !== 'runtime-repair') return undefined
  const action = routeParamText(params.action)
  const target = routeParamText(params.target)
  const event = routeParamText(params.event)
  const severity = routeParamText(params.severity)
  const issueCodes = routeParamList(params.issueCodes)
  const sourceEventIds = routeParamList(params.sourceEventIds)
  const latestEventId = routeParamText(params.latestEventId) ?? sourceEventIds[0]
  const eventCount = routeParamPositiveInteger(params.eventCount, 1)
  const replayContext = findRuntimeRepairReplayContext(conversation)
  const providerId = routeParamText(params.providerId)
  const model = routeParamText(params.model)
  const credentialGroupId = routeParamText(params.credentialGroupId)
  const scope = [
    providerId,
    model,
    credentialGroupId,
  ].filter(Boolean).join('/') || routeParamText(params.id) || event || t('common.unknown')
  const repairSummary = truncateRuntimeRepairText(routeParamText(params.summary), 360)
  const summary = repairSummary || t('common.none')
  const repairSteps = buildRuntimeRepairReplaySteps({
    action,
    target,
    event,
    latestEventId,
    issueCodes,
  })
  const payloadJson = buildRuntimeRepairReplayPayloadJson({
    conversationId: conversation.id,
    action,
    target,
    event,
    severity,
    scope,
    providerId,
    credentialGroupId,
    model,
    issueCodes,
    eventCount,
    latestEventId,
    sourceEventIds,
    repairSteps,
    summary: repairSummary,
    previousUserMessage: replayContext.previousUserMessage,
    failureSummary: replayContext.failureSummary,
  })
  const prompt = t('chat.runtimeRepairRetryPrompt', {
    action: action ? t(`settings.runtimeDiagnosticTimelineNextAction.${action}`) : t('common.unknown'),
    target: target ? t(`settings.runtimeDiagnosticTimelineActionTarget.${target}`) : t('common.unknown'),
    event: event ?? t('common.unknown'),
    eventId: latestEventId ?? t('common.none'),
    severity: severity ? t(`settings.runtimeDiagnosticTimelineSeverity.${severity}`) : t('common.unknown'),
    scope,
    issueCodes: issueCodes.length ? issueCodes.join(', ') : t('common.none'),
    eventCount,
    summary,
    payloadJson,
    previousUserMessage: replayContext.previousUserMessage ?? t('common.none'),
    failureSummary: replayContext.failureSummary ?? t('common.none'),
  })
  return {
    key: [
      'runtime-repair',
      conversation.id,
      action ?? '',
      target ?? '',
      event ?? '',
      latestEventId ?? '',
      routeParamText(params.eventCount) ?? '',
    ].join(':'),
    prompt,
    payloadJson,
    payloadSchema: RUNTIME_REPAIR_REPLAY_PAYLOAD_SCHEMA,
    repairStepCount: repairSteps.length,
    scope,
    summary,
    action: action ?? '',
    actionLabel: action ? t(`settings.runtimeDiagnosticTimelineNextAction.${action}`) : t('common.unknown'),
    target: target ?? '',
    targetLabel: target ? t(`settings.runtimeDiagnosticTimelineActionTarget.${target}`) : t('common.unknown'),
    event: event ?? t('common.unknown'),
    latestEventId,
    sourceEventIds,
    eventCount,
    issueCodes,
    severity,
    severityLabel: severity ? t(`settings.runtimeDiagnosticTimelineSeverity.${severity}`) : undefined,
  }
}

function buildRuntimeRepairReplayPayloadJson(input: Omit<RuntimeRepairReplayPayload, 'schema'>): string {
  const payload: RuntimeRepairReplayPayload = {
    schema: RUNTIME_REPAIR_REPLAY_PAYLOAD_SCHEMA,
    conversationId: input.conversationId,
    ...(input.action ? { action: truncateRuntimeRepairText(input.action, 96) } : {}),
    ...(input.target ? { target: truncateRuntimeRepairText(input.target, 96) } : {}),
    ...(input.event ? { event: truncateRuntimeRepairText(input.event, 120) } : {}),
    ...(input.severity ? { severity: truncateRuntimeRepairText(input.severity, 48) } : {}),
    scope: truncateRuntimeRepairText(input.scope, 240),
    ...(input.providerId ? { providerId: truncateRuntimeRepairText(input.providerId, 96) } : {}),
    ...(input.credentialGroupId ? { credentialGroupId: truncateRuntimeRepairText(input.credentialGroupId, 96) } : {}),
    ...(input.model ? { model: truncateRuntimeRepairText(input.model, 120) } : {}),
    issueCodes: input.issueCodes.map((item) => truncateRuntimeRepairText(item, 96)).filter(Boolean).slice(0, 8),
    eventCount: input.eventCount,
    ...(input.latestEventId ? { latestEventId: truncateRuntimeRepairText(input.latestEventId, 160) } : {}),
    sourceEventIds: input.sourceEventIds.map((item) => truncateRuntimeRepairText(item, 160)).filter(Boolean).slice(0, 8),
    repairSteps: input.repairSteps.map(normalizeRuntimeRepairReplayStep).slice(0, 6),
    ...(input.summary ? { summary: truncateRuntimeRepairText(input.summary, 360) } : {}),
    ...(input.previousUserMessage ? { previousUserMessage: truncateRuntimeRepairText(input.previousUserMessage, 520) } : {}),
    ...(input.failureSummary ? { failureSummary: truncateRuntimeRepairText(input.failureSummary, 520) } : {}),
  }
  return JSON.stringify(payload, null, 2)
}

function buildRuntimeRepairReplaySteps(input: {
  action?: string
  target?: string
  event?: string
  latestEventId?: string
  issueCodes: string[]
}): RuntimeRepairReplayStep[] {
  const steps: RuntimeRepairReplayStep[] = [
    {
      id: 'preserve-user-intent',
      kind: 'preserve_user_intent',
      instruction: 'Preserve the previous user request and use runtime diagnostics only to choose the retry path.',
      requiredBeforeRetry: true,
    },
    {
      id: 'inspect-runtime-event',
      kind: 'inspect_runtime_event',
      instruction: 'Use the latest runtime event id, source event ids, and issue codes to identify the failing provider/tool/context/session path.',
      target: input.latestEventId,
      requiredBeforeRetry: true,
    },
  ]
  const actionStep = runtimeRepairReplayActionStep(input)
  if (actionStep) steps.push(actionStep)
  steps.push({
    id: 'retry-and-report-blocker',
    kind: 'retry_and_report_blocker',
    instruction: 'Retry once with the adjusted path. If blocked again, explain the remaining blocker before asking for user input.',
    target: input.event,
    requiredBeforeRetry: false,
  })
  return steps
}

function runtimeRepairReplayActionStep(input: {
  action?: string
  target?: string
  event?: string
  issueCodes: string[]
}): RuntimeRepairReplayStep | undefined {
  switch (input.action) {
    case 'check_provider_credentials':
      return runtimeRepairReplayStep('check-provider-credentials', 'check_provider_credentials', 'Verify provider credential health, enabled state, model availability, and cooldown before retrying.', input)
    case 'review_provider_policy':
      return runtimeRepairReplayStep('review-provider-policy', 'review_provider_policy', 'Review provider policy, payload conformance, and blocked capability evidence before retrying.', input)
    case 'retry_or_switch_provider':
      return runtimeRepairReplayStep('retry-or-switch-provider', 'retry_or_switch_provider', 'Retry the same intent; switch provider, model, or credential group only when the runtime event indicates the current route is still blocked.', input)
    case 'fix_tool_schema':
      return runtimeRepairReplayStep('fix-tool-schema', 'fix_tool_schema', 'Repair the MCP or provider-native tool schema, or disable incompatible structured output before retrying.', input)
    case 'cap_context_source':
      return runtimeRepairReplayStep('cap-context-source', 'cap_context_source', 'Cap or remove the unbounded context source before retrying so model-visible context remains bounded.', input)
    case 'review_session_affinity':
      return runtimeRepairReplayStep('review-session-affinity', 'review_session_affinity', 'Review session affinity binding, cooldown, and failover state before reusing or rotating the credential group.', input)
    case 'enable_compact_or_reduce_history':
      return runtimeRepairReplayStep('enable-compact-or-reduce-history', 'enable_compact_or_reduce_history', 'Enable compact or reduce conversation history before retrying the original request.', input)
    default:
      return undefined
  }
}

function runtimeRepairReplayStep(
  id: string,
  kind: string,
  instruction: string,
  input: { action?: string; target?: string; event?: string; issueCodes: string[] },
): RuntimeRepairReplayStep {
  return {
    id,
    kind,
    instruction,
    ...(input.target ? { target: input.target } : {}),
    ...(input.action ? { action: input.action } : {}),
    requiredBeforeRetry: true,
  }
}

function normalizeRuntimeRepairReplayStep(step: RuntimeRepairReplayStep): RuntimeRepairReplayStep {
  return {
    id: truncateRuntimeRepairText(step.id, 96),
    kind: truncateRuntimeRepairText(step.kind, 96),
    instruction: truncateRuntimeRepairText(step.instruction, 280),
    ...(step.target ? { target: truncateRuntimeRepairText(step.target, 160) } : {}),
    ...(step.action ? { action: truncateRuntimeRepairText(step.action, 96) } : {}),
    requiredBeforeRetry: step.requiredBeforeRetry === true,
  }
}

function findRuntimeRepairReplayContext(conversation: Conversation): { previousUserMessage?: string; failureSummary?: string } {
  const failedIndex = findLastMessageIndex(conversation.messages, isRuntimeRepairFailureMessage)
  const fallbackAssistantIndex = failedIndex >= 0
    ? failedIndex
    : findLastMessageIndex(conversation.messages, (message) => message.role === 'assistant')
  const previousUserIndex = findPreviousUserMessageIndex(conversation.messages, fallbackAssistantIndex)
  return {
    previousUserMessage: previousUserIndex >= 0 ? summarizeRuntimeRepairMessageText(conversation.messages[previousUserIndex]) : undefined,
    failureSummary: fallbackAssistantIndex >= 0 ? summarizeRuntimeRepairFailureMessage(conversation.messages[fallbackAssistantIndex]) : undefined,
  }
}

function findLastMessageIndex(messages: Message[], predicate: (message: Message) => boolean): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (predicate(messages[index])) return index
  }
  return -1
}

function findPreviousUserMessageIndex(messages: Message[], beforeIndex: number): number {
  const startIndex = beforeIndex >= 0 ? beforeIndex - 1 : messages.length - 1
  for (let index = startIndex; index >= 0; index -= 1) {
    if (messages[index].role === 'user') return index
  }
  return -1
}

function isRuntimeRepairFailureMessage(message: Message): boolean {
  if (message.role !== 'assistant') return false
  if (message.status === 'error') return true
  if (message.errorCode) return true
  return runtimeRepairMessageTraces(message).some((trace) => trace.status === 'error')
}

function summarizeRuntimeRepairFailureMessage(message: Message): string {
  const errorTrace = runtimeRepairMessageTraces(message).find((trace) => trace.status === 'error')
  return [
    message.status,
    message.errorCode,
    message.errorProviderId,
    summarizeRuntimeRepairMessageText(message),
    errorTrace ? summarizeRuntimeRepairTrace(errorTrace) : '',
  ].filter(Boolean).join(' · ')
}

function summarizeRuntimeRepairMessageText(message: Message): string {
  return truncateRuntimeRepairText(message.responseText || message.content, 520)
}

function summarizeRuntimeRepairTrace(trace: ProcessTrace): string {
  return truncateRuntimeRepairText([
    trace.title,
    trace.content,
  ].filter(Boolean).join(': '), 520)
}

function runtimeRepairMessageTraces(message: Message): ProcessTrace[] {
  return [
    ...(message.retrievalTrace ?? []),
    ...(message.reasoning ?? []),
    ...(message.toolCalls ?? []),
  ]
}

function truncateRuntimeRepairText(value: string | undefined, limit: number): string {
  const text = value?.replace(/\s+/g, ' ').trim() ?? ''
  if (!text) return ''
  return text.length > limit ? `${text.slice(0, limit - 1).trim()}...` : text
}

function routeParamText(value: string | string[] | undefined): string | undefined {
  const text = Array.isArray(value) ? value[0] : value
  return typeof text === 'string' && text.trim() ? text : undefined
}

function routeParamList(value: string | string[] | undefined): string[] {
  const text = routeParamText(value)
  if (!text) return []
  return text.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 8)
}

function routeParamPositiveInteger(value: string | string[] | undefined, fallback: number): number {
  const number = Number.parseInt(routeParamText(value) ?? '', 10)
  return Number.isFinite(number) && number > 0 ? number : fallback
}
