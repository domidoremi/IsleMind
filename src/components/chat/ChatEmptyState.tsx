import { Text, View, useWindowDimensions } from 'react-native'
import { useTranslation } from 'react-i18next'

import {
  AnimatedNavigationIcon,
  type NavigationGlyph,
} from '@/components/navigation/AnimatedNavigationIcon'
import { useNavigationTrigger } from '@/components/navigation/AnimatedNavigationTrigger'
import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import { IsleImage, IslePressable, useIsleDialog } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import {
  CHAT_PRESENTATION_CATALOG,
  type ChatBoundaryDefinition,
  type ChatMemoryDefinition,
  type ChatStarterDefinition,
} from '@/presentation/features/chat/chatPresentationCatalog'
import {
  getChatBoundaryStatusActionMetadata,
  resolveChatBoundaryStatusAction,
  type ChatBoundaryStatusAction,
  type ChatBoundaryStatusActionMetadata,
} from '@/presentation/features/chat/chatBoundaryStatus'
import {
  CHAT_MULTIMODAL_ENTRIES,
  getChatMediaGenerationGateMetadata,
  type ChatMediaGenerationAdapterGateId,
  type ChatMultimodalPolicy,
} from '@/presentation/features/chat/chatMultimodalPolicy'
import {
  resolveProductMobileChatSetupLayout,
  resolveProductMobileLayout,
} from '@/presentation/layout/productMobileLayout'
import type { Attachment } from '@/types/chatContracts'

import { ChatEmptyStateExperience } from './theme-experiences/ChatEmptyStateExperience'
import { shouldRenderChatSetupBoundaryStatus } from './chatSetupBoundaryVisibility'

export interface ChatBoundaryMemoryStatus {
  active: number
  pending: number
}

export interface ChatEmptyStateProjection {
  boundary: ChatBoundaryDefinition
  memory: ChatMemoryDefinition
  primaryStarter: ChatStarterDefinition | undefined
  memoryStatus: ChatBoundaryMemoryStatus
  mediaReady: number
  mediaTotal: number
  generationReady: number
  generationTotal: number
  generationUnavailableCount: number
  generationGateIds: readonly ChatMediaGenerationAdapterGateId[]
  action: ChatBoundaryStatusActionMetadata
  accessibility: {
    role: 'button'
    minimumTouchTarget: number
    labelKey: 'chatPresentation.boundaryAccessibilityLabelWithStatus'
    hintKey: 'chatPresentation.boundaryStatusAccessibilityHint'
  }
}

interface ResolveChatEmptyStateProjectionInput {
  multimodalPolicy?: ChatMultimodalPolicy | null
  memoryStatus?: ChatBoundaryMemoryStatus
  canInspectProvider?: boolean
  canOpenMemory?: boolean
  canOpenTools?: boolean
}

interface ChatEmptyStateDialogPort {
  confirm(input: {
    title: string
    message: string
    confirmLabel: string
    cancelLabel: string
  }): Promise<boolean>
  notice(input: {
    title: string
    message: string
    actionLabel: string
  }): void
}

interface PresentChatEmptyStateBoundaryActionInput {
  action: ChatBoundaryStatusAction
  dialog: ChatEmptyStateDialogPort
  title: string
  message: string
  actionLabel: string
  doneLabel: string
  onInspectProvider?: () => void | Promise<void>
  onOpenMemory?: () => void | Promise<void>
  onOpenTools?: () => void | Promise<void>
}

const CHAT_BOUNDARY = CHAT_PRESENTATION_CATALOG.boundary
const CHAT_MEMORY = CHAT_PRESENTATION_CATALOG.memory
const CHAT_STARTERS = CHAT_PRESENTATION_CATALOG.starters
const CHAT_ENTRY_STARTER_LIMIT = 1
const CHAT_SHOW_ENTRY_DESCRIPTION = false
const QUICK_START_ACTION_HIT_SLOP = { top: 8, right: 8, bottom: 8, left: 8 }
const LIME_ROAD_COMPANION_SOURCE = require('../../../assets/brand/generated/isle-pet-icon-transparent.png')

export const CHAT_EMPTY_STATE_MIN_TOUCH_TARGET = 44

export function resolveChatEmptyStateProjection({
  multimodalPolicy,
  memoryStatus,
  canInspectProvider = true,
  canOpenMemory = true,
  canOpenTools = true,
}: ResolveChatEmptyStateProjectionInput): ChatEmptyStateProjection {
  const normalizedMemoryStatus = {
    active: Math.max(0, Math.round(memoryStatus?.active ?? 0)),
    pending: Math.max(0, Math.round(memoryStatus?.pending ?? 0)),
  }
  const mediaTotal = CHAT_MULTIMODAL_ENTRIES.length
  const mediaReady = multimodalPolicy
    ? Math.max(0, mediaTotal - multimodalPolicy.unavailableCount)
    : mediaTotal
  const generationTotal =
    multimodalPolicy?.generationGateReadinessSummary.total ?? 0
  const generationReady = Math.min(
    generationTotal,
    Math.max(0, multimodalPolicy?.generationGateReadinessSummary.ready ?? 0),
  )
  const action = resolveChatBoundaryStatusAction({
    multimodalPolicy,
    pendingMemoryCount: normalizedMemoryStatus.pending,
    canInspectProvider,
    canOpenMemory,
    canOpenTools,
  })

  return {
    boundary: CHAT_BOUNDARY,
    memory: CHAT_MEMORY,
    primaryStarter: CHAT_STARTERS.slice(0, CHAT_ENTRY_STARTER_LIMIT)[0],
    memoryStatus: normalizedMemoryStatus,
    mediaReady,
    mediaTotal,
    generationReady,
    generationTotal,
    generationUnavailableCount:
      multimodalPolicy?.generationUnavailableCount ?? 0,
    generationGateIds: multimodalPolicy?.generationGateIds ?? [],
    action: getChatBoundaryStatusActionMetadata(action),
    accessibility: {
      role: 'button',
      minimumTouchTarget: CHAT_EMPTY_STATE_MIN_TOUCH_TARGET,
      labelKey: 'chatPresentation.boundaryAccessibilityLabelWithStatus',
      hintKey: 'chatPresentation.boundaryStatusAccessibilityHint',
    },
  }
}

export function resolveChatConversationEmptyStateMinHeight(
  minHeight: number,
): number {
  return Number.isFinite(minHeight) ? Math.max(0, minHeight) : 0
}

export async function presentChatEmptyStateBoundaryAction({
  action,
  dialog,
  title,
  message,
  actionLabel,
  doneLabel,
  onInspectProvider,
  onOpenMemory,
  onOpenTools,
}: PresentChatEmptyStateBoundaryActionInput): Promise<void> {
  if (action === 'notice') {
    dialog.notice({ title, message, actionLabel: doneLabel })
    return
  }

  const confirmed = await dialog.confirm({
    title,
    message,
    confirmLabel: actionLabel,
    cancelLabel: doneLabel,
  })
  if (!confirmed) return

  if (action === 'provider') {
    await onInspectProvider?.()
    return
  }
  if (action === 'memory') {
    await onOpenMemory?.()
    return
  }
  await onOpenTools?.()
}

function ChatEmptyStateIntro({
  title,
  description,
  maxWidth,
  compactLandscape = false,
  showDecoration = true,
  showDescription = true,
}: {
  title: string
  description?: string
  maxWidth: number
  compactLandscape?: boolean
  showDecoration?: boolean
  showDescription?: boolean
}) {
  const { colors } = useAppTheme()
  const accessibilityLabel = description ? `${title}. ${description}` : title

  if (colors.ui.experience.layout === 'editorial') {
    return (
      <View
        accessible
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="summary"
        style={{
          width: '100%',
          maxWidth,
          alignSelf: 'center',
          gap: compactLandscape ? 0 : 8,
        }}
      >
        <View style={{ minHeight: compactLandscape ? 0 : 88, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              numberOfLines={compactLandscape ? 1 : 2}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
              style={{
                color: colors.text,
                fontSize: compactLandscape ? 21 : 24,
                lineHeight: compactLandscape ? 25 : 29,
                fontWeight: '900',
                textAlign: 'left',
                includeFontPadding: false,
              }}
            >
              {title}
            </Text>
            {showDecoration ? (
              <View style={{ marginTop: 8, width: 54, height: 3, backgroundColor: colors.primary }} />
            ) : null}
          </View>
          {showDecoration ? (
            <View>
              <LimeRoadCompanionMark />
            </View>
          ) : null}
        </View>
        {description && showDescription ? (
          <Text
            style={{ maxWidth: Math.max(180, maxWidth - 24), color: colors.textSecondary, fontSize: 12.5, lineHeight: 19, fontWeight: '600', textAlign: 'left', includeFontPadding: false }}
          >
            {description}
          </Text>
        ) : null}
      </View>
    )
  }

  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="summary"
      style={{
        width: '100%',
        maxWidth,
        alignSelf: 'center',
        alignItems: 'center',
        gap: compactLandscape ? 3 : 6,
      }}
    >
      {showDecoration ? (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {colors.ui.limeRoad ? (
            <LimeRoadCompanionMark />
          ) : (
            <AppIcon
              name={CHAT_BOUNDARY.glyph}
              color={colors.ui.icon.accentForeground}
              size={20}
              strokeWidth={appIconStroke.fine}
            />
          )}
        </View>
      ) : null}
      <Text
        numberOfLines={compactLandscape ? 1 : undefined}
        adjustsFontSizeToFit={compactLandscape}
        minimumFontScale={0.82}
        style={{
          color: colors.text,
          fontSize: 19,
          lineHeight: 25,
          fontWeight: '700',
          textAlign: 'center',
          includeFontPadding: false,
        }}
      >
        {title}
      </Text>
      {description && showDescription ? (
        <Text
          style={{
            color: colors.textSecondary,
            fontSize: 12.5,
            lineHeight: 19,
            fontWeight: '500',
            textAlign: 'center',
            includeFontPadding: false,
          }}
        >
          {description}
        </Text>
      ) : null}
    </View>
  )
}

function LimeRoadCompanionMark() {
  const { colors } = useAppTheme()

  return (
    <View
      style={{
        width: 94,
        height: 76,
        position: 'relative',
        alignItems: 'center',
        justifyContent: 'flex-end',
      }}
    >
      <View
        style={{
          position: 'absolute',
          top: 7,
          left: 6,
          width: 62,
          height: 28,
          borderLeftWidth: 2,
          borderTopWidth: 2,
          borderColor: colors.primary,
          transform: [{ rotate: '-5deg' }],
        }}
      />
      <IsleImage
        source={LIME_ROAD_COMPANION_SOURCE}
        alt=""
        width={68}
        height={68}
        preview={false}
        contentFit="contain"
        style={{
          minHeight: 0,
          borderWidth: 0,
          borderRadius: 0,
          backgroundColor: 'transparent',
        }}
      />
      <View
        style={{
          position: 'absolute',
          right: 1,
          bottom: 6,
          width: 14,
          height: 14,
          borderRadius: 7,
          borderWidth: 3,
          borderColor: colors.accent,
          backgroundColor: colors.paper,
        }}
      />
    </View>
  )
}

export function ChatSetupEmptyState({
  title,
  description,
  actionLabel,
  actionHint,
  glyph,
  multimodalPolicy,
  memoryStatus,
  onInspectProvider,
  onOpenMemory,
  onOpenTools,
  onStarter,
  onAction,
}: {
  title: string
  description?: string
  actionLabel?: string
  actionHint?: string
  glyph?: NavigationGlyph
  multimodalPolicy: ChatMultimodalPolicy
  memoryStatus: ChatBoundaryMemoryStatus
  onInspectProvider?: () => void
  onOpenMemory?: () => void
  onOpenTools?: () => void
  onStarter?: (starter: ChatStarterDefinition) => void
  onAction?: () => void
}) {
  const { colors, themeId } = useAppTheme()
  const { width, height } = useWindowDimensions()
  const starterLayout = resolveProductMobileLayout(width).starter
  const setupLayout = resolveProductMobileChatSetupLayout(width, height)
  const navigation = useNavigationTrigger(onAction ?? (() => undefined))
  const primaryStarter = resolveChatEmptyStateProjection({
    multimodalPolicy,
    memoryStatus,
    canInspectProvider: !!onInspectProvider,
    canOpenMemory: !!onOpenMemory,
    canOpenTools: !!onOpenTools,
  }).primaryStarter
  const showAction = !!actionLabel && !!glyph && !!onAction
  const showBoundaryStatus = shouldRenderChatSetupBoundaryStatus(multimodalPolicy)

  return (
    <ChatEmptyStateExperience
      themeId={themeId}
      colors={colors}
      title={title}
      context="setup"
      intro={<ChatEmptyStateIntro
        title={title}
        description={description}
        maxWidth={starterLayout.setupContentMaxWidth}
        compactLandscape={setupLayout.compactLandscape}
        showDecoration={setupLayout.showIntroDecoration}
        showDescription={setupLayout.showIntroDescription}
      />}
      boundary={showBoundaryStatus ? (
        <ChatBoundaryStatusAction
          multimodalPolicy={multimodalPolicy}
          memoryStatus={memoryStatus}
          onInspectProvider={onInspectProvider}
          onOpenMemory={onOpenMemory}
          onOpenTools={onOpenTools}
          maxWidth={starterLayout.setupContentMaxWidth}
        />
      ) : null}
      starter={primaryStarter && onStarter ? (
        <ChatStarterAction
          starter={primaryStarter}
          maxWidth={starterLayout.setupContentMaxWidth}
          onPress={() => onStarter(primaryStarter)}
        />
      ) : null}
      action={showAction ? (
        <IslePressable
          haptic
          onPress={navigation.trigger}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          accessibilityHint={actionHint}
          hitSlop={QUICK_START_ACTION_HIT_SLOP}
          style={{
            minHeight: CHAT_EMPTY_STATE_MIN_TOUCH_TARGET,
            minWidth: starterLayout.actionMinWidth,
            paddingHorizontal: 14,
            borderRadius: colors.ui.experience.layout === 'editorial' ? 5 : colors.ui.radius.controlLarge,
            flexDirection: 'row',
            gap: 7,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.ui.control.primaryBackground,
            borderWidth: colors.ui.limeRoad ? 1 : 0,
            borderColor: colors.ui.control.primaryBorder,
          }}
        >
          <AnimatedNavigationIcon
            glyph={glyph}
            active={navigation.active}
            color={colors.ui.control.primaryForeground}
            size={18}
          />
          <Text
            numberOfLines={1}
            style={{
              flexShrink: 1,
              color: colors.ui.control.primaryForeground,
              fontSize: 14,
              fontWeight: '700',
              includeFontPadding: false,
            }}
          >
            {actionLabel}
          </Text>
        </IslePressable>
      ) : null}
    />
  )
}

function ChatStarterAction({
  starter,
  maxWidth,
  onPress,
}: {
  starter: ChatStarterDefinition
  maxWidth: number
  onPress: () => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const title = t(starter.titleKey)
  const description = t(starter.descriptionKey)

  return (
    <IslePressable
      haptic
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={description}
      onPress={onPress}
      hitSlop={QUICK_START_ACTION_HIT_SLOP}
      style={{
        width: '100%',
        maxWidth,
        minHeight: CHAT_EMPTY_STATE_MIN_TOUCH_TARGET,
        paddingHorizontal: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: colors.ui.experience.layout === 'editorial' ? 'flex-start' : 'center',
        gap: 7,
      }}
    >
      <AppIcon
        name={starter.glyph}
        color={colors.textSecondary}
        size={15}
        strokeWidth={appIconStroke.strong}
      />
      <Text
        numberOfLines={1}
        style={{
          flexShrink: 1,
          color: colors.textSecondary,
          fontSize: 13,
          lineHeight: 18,
          fontWeight: '600',
          includeFontPadding: false,
        }}
      >
        {title}
      </Text>
    </IslePressable>
  )
}

function ChatBoundaryStatusAction({
  multimodalPolicy,
  memoryStatus,
  onInspectProvider,
  onOpenMemory,
  onOpenTools,
  maxWidth,
}: {
  multimodalPolicy?: ChatMultimodalPolicy
  memoryStatus?: ChatBoundaryMemoryStatus
  onInspectProvider?: () => void
  onOpenMemory?: () => void
  onOpenTools?: () => void
  maxWidth: number
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const { width } = useWindowDimensions()
  const starterLayout = resolveProductMobileLayout(width).starter
  const projection = resolveChatEmptyStateProjection({
    multimodalPolicy,
    memoryStatus,
    canInspectProvider: !!onInspectProvider,
    canOpenMemory: !!onOpenMemory,
    canOpenTools: !!onOpenTools,
  })
  const { boundary, memory } = projection
  const title = t(boundary.titleKey)
  const description = t(boundary.descriptionKey)
  const memoryTitle = t(memory.titleKey)
  const memorySummary = t(memory.summaryKey)
  const memoryVisibility = t(memory.visibilityKey)
  const contextMemoryStatus = t('chatPresentation.memoryStatusLabel', {
    active: projection.memoryStatus.active,
    pending: projection.memoryStatus.pending,
  })
  const mediaStatus = t('chatPresentation.mediaStatusLabel', {
    ready: projection.mediaReady,
    total: projection.mediaTotal,
  })
  const generationGateSummary = projection.generationGateIds
    .map((gateId) =>
      t(getChatMediaGenerationGateMetadata(gateId).labelKey),
    )
    .join(' · ')
  const generationStatus = projection.generationUnavailableCount
    ? t('chatPresentation.generationLockedStatusLabel', {
        count: projection.generationGateIds.length,
        ready: projection.generationReady,
        total: projection.generationTotal,
        gates: generationGateSummary,
      })
    : t('chatPresentation.generationReadyStatusLabel')
  const providerStatus = multimodalPolicy?.providerName
    ? `${multimodalPolicy.providerName}${multimodalPolicy.model ? ` · ${multimodalPolicy.model}` : ''}`
    : t('chat.noProviderConnected')
  const boundaryStatusActionLabel = t(projection.action.labelKey)
  const accessibilityParams = {
    title,
    description,
    memoryTitle,
    memorySummary,
    memoryVisibility,
    memoryStatus: contextMemoryStatus,
    mediaStatus,
    generationStatus,
  }
  const noticeTitle = t('chatPresentation.boundaryStatusNoticeTitle', { title })
  const noticeMessage = t('chatPresentation.boundaryStatusNoticeMessage', {
    memoryTitle,
    memorySummary,
    memoryVisibility,
    memoryStatus: contextMemoryStatus,
    mediaStatus,
    generationStatus,
    provider: providerStatus,
  })

  return (
    <IslePressable
      haptic
      accessibilityLabel={t(projection.accessibility.labelKey, accessibilityParams)}
      accessibilityHint={t(projection.accessibility.hintKey, {
        action: boundaryStatusActionLabel,
      })}
      accessibilityRole={projection.accessibility.role}
      onPress={() => {
        void presentChatEmptyStateBoundaryAction({
          action: projection.action.action,
          dialog,
          title: noticeTitle,
          message: noticeMessage,
          actionLabel: boundaryStatusActionLabel,
          doneLabel: t('common.done'),
          onInspectProvider,
          onOpenMemory,
          onOpenTools,
        })
      }}
      hitSlop={QUICK_START_ACTION_HIT_SLOP}
      style={{
        width: '100%',
        maxWidth,
        minHeight: projection.accessibility.minimumTouchTarget,
        alignSelf: 'center',
        paddingHorizontal: 8,
        borderRadius: colors.ui.radius.chip,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        backgroundColor: colors.ui.semantic.surface.muted,
        borderWidth: colors.ui.limeRoad ? 1 : 0,
        borderColor: colors.ui.semantic.chrome.border,
      }}
    >
      <AppIcon
        name={memory.glyph || boundary.glyph}
        color={colors.textTertiary}
        size={13}
        strokeWidth={appIconStroke.strong}
      />
      <Text
        numberOfLines={1}
        style={{
          flexShrink: 1,
          color: colors.textTertiary,
          fontSize: 11.5,
          lineHeight: 16,
          fontWeight: '600',
          includeFontPadding: false,
        }}
      >
        {title} · {memoryVisibility} · {mediaStatus}
      </Text>
      <AppIcon
        name={projection.action.glyph}
        color={colors.textTertiary}
        size={starterLayout.statusPillGlyphSize}
        strokeWidth={appIconStroke.strong}
      />
    </IslePressable>
  )
}

export function ChatConversationEmptyState({
  multimodalPolicy,
  memoryStatus,
  title,
  description,
  onProviders,
  onOpenMemory,
  onOpenTools,
  onApplyStarter,
  minHeight,
}: {
  multimodalPolicy: ChatMultimodalPolicy
  memoryStatus: ChatBoundaryMemoryStatus
  title: string
  description: string
  onProviders: () => void
  onOpenMemory: () => void
  onOpenTools: () => void
  onApplyStarter: (
    draft: string,
    attachments?: Attachment[],
    restoreIfEmpty?: boolean,
  ) => void
  minHeight: number
}) {
  const { t } = useTranslation()
  const { colors, themeId } = useAppTheme()
  const { width } = useWindowDimensions()
  const starterLayout = resolveProductMobileLayout(width).starter
  const primaryStarter = resolveChatEmptyStateProjection({
    multimodalPolicy,
    memoryStatus,
    canInspectProvider: true,
    canOpenMemory: true,
    canOpenTools: true,
  }).primaryStarter

  return (
    <View
      style={{
        width: '100%',
        minHeight: resolveChatConversationEmptyStateMinHeight(minHeight),
        paddingHorizontal: 20,
        alignItems: colors.ui.experience.layout === 'editorial' ? 'stretch' : 'center',
        justifyContent: 'center',
        gap: 8,
      }}
    >
      <ChatEmptyStateExperience
        themeId={themeId}
        colors={colors}
        title={title}
        context="conversation"
        intro={<ChatEmptyStateIntro
          title={title}
          description={CHAT_SHOW_ENTRY_DESCRIPTION ? description : undefined}
          maxWidth={starterLayout.emptyContentMaxWidth}
        />}
        boundary={<ChatBoundaryStatusAction
          multimodalPolicy={multimodalPolicy}
          memoryStatus={memoryStatus}
          onInspectProvider={onProviders}
          onOpenMemory={onOpenMemory}
          onOpenTools={onOpenTools}
          maxWidth={starterLayout.emptyContentMaxWidth}
        />}
        starter={primaryStarter ? (
          <ChatStarterAction
            starter={primaryStarter}
            maxWidth={starterLayout.emptyContentMaxWidth}
            onPress={() => onApplyStarter(t(primaryStarter.promptKey), [], true)}
          />
        ) : null}
      />
    </View>
  )
}
