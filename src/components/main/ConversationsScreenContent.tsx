import { router } from 'expo-router'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, AppState, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent, type ViewToken } from 'react-native'
import { FlashList, type FlashListRef } from '@shopify/flash-list'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AnimatedNavigationTrigger } from '@/components/navigation/AnimatedNavigationTrigger'
import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import { IsleEmptyState, IsleHeader, IslePressable, useIsleDialog } from '@/components/ui/isle'
import { ConversationRow } from '@/components/conversations/ConversationRow'
import { useMainPagerGestureLock } from './MainPagerGestureLock'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { normalizeSearchText } from '@/utils/text'
import { getPolicyPreferredProviderModel } from '@/services/ai/policy/providerModelAccess'
import { getProviderDisplayModel } from '@/utils/providerModels'
import type { AIProvider, Conversation } from '@/types'

interface ConversationsScreenContentProps {
  active?: boolean
  onHome?: () => void
  onSettings?: () => void
}

const SEARCH_FIRST_MESSAGE_LIMIT = 2
const SEARCH_RECENT_MESSAGE_LIMIT = 8
const SEARCH_FIELD_PREVIEW_LIMIT = 240
const SEARCH_FIELD_INDEX_LIMIT = 1800
const SEARCH_MESSAGE_FIELD_INDEX_LIMIT = 2400
const SEARCH_MESSAGE_FIELD_SCAN_MULTIPLIER = 4
const SEARCH_MATCH_CONTEXT_RADIUS = 72
const SEARCH_MESSAGE_INDEX_BUDGET = 12000
const LIST_INITIAL_RENDER_COUNT = 10
const LIST_ENTRANCE_ANIMATION_MAX_COUNT = 14
const LIST_RENDER_BATCH_SIZE = 8
const LIST_WINDOW_SIZE = 7
const LIST_END_FEEDBACK_MIN_COUNT = LIST_INITIAL_RENDER_COUNT + 1
const SCROLL_TOP_ACTION_OFFSET = 360
const SCROLL_TOP_ACTION_SIZE = 44
const FLOATING_HISTORY_ACTION_GAP = 10
const SCROLL_TOP_ACTION_CLEARANCE = 12
const SCROLL_TOP_ACTION_LOCK_MS = 420
const CURRENT_CONVERSATION_ACTION_LOCK_MS = 420
const CURRENT_CONVERSATION_SCROLL_VIEW_POSITION = 0.28
const CONVERSATION_ROW_ESTIMATED_HEIGHT = 104
const CURRENT_CONVERSATION_VISIBLE_MARGIN = 48
const CONVERSATION_LIST_RESERVED_HEIGHT = 168
const CONVERSATION_VIEWABILITY_VISIBLE_PERCENT = 36
const CONVERSATION_ROW_HEIGHT_CACHE_PREFIX_DEFAULT = 'default'
const CONVERSATION_ROW_HEIGHT_CACHE_PREFIX_SEARCH = 'search'
const RENAME_SCROLL_RETRY_DELAY_MS = 140
const RELATIVE_TIME_REFRESH_MS = 60 * 1000
const RELATIVE_TIME_SCROLL_RELEASE_DELAY_MS = 160
const LIST_INTERACTION_FAILSAFE_MS = 1200
const LIST_TAP_AFTER_USER_SCROLL_GUARD_MS = 96
const LIST_TAP_AFTER_PROGRAMMATIC_SCROLL_GUARD_MS = 120
const LIST_TOUCH_PAGER_GESTURE_RELEASE_DELAY_MS = 120
const PROGRAMMATIC_LIST_SCROLL_GUARD_MS = 520
const LIST_BLOCKED_FEEDBACK_THROTTLE_MS = 1600
const ICON_ACTION_HIT_SLOP = { top: 10, right: 10, bottom: 10, left: 10 }

type ConversationSearchFieldKey = 'title' | 'provider' | 'model' | 'systemPrompt' | 'message'

const SEARCH_FIELD_MATCH_WEIGHT: Record<ConversationSearchFieldKey, number> = {
  title: 520,
  model: 320,
  provider: 280,
  message: 180,
  systemPrompt: 140,
}

interface ConversationSearchField {
  key: ConversationSearchFieldKey
  value: string
  indexedValue: string
  normalized: string
}

interface ConversationSearchIndexItem {
  conversation: Conversation
  searchableText: string
  fields: ConversationSearchField[]
}

interface ConversationSearchIndexState {
  index: ConversationSearchIndexItem[]
  source: Conversation[] | null
}

interface ConversationSearchResult {
  conversation: Conversation
  match: ConversationSearchField
  score: number
  recency: number
  originalIndex: number
}

interface ConversationSearchMatchPresentation {
  preview: string
  fieldLabel: string
  accessibilitySummary: string
}

interface VisibleConversationRange {
  start: number
  end: number
  total: number
  searchActive: boolean
}

export function ConversationsScreenContent({ active = true, onHome, onSettings }: ConversationsScreenContentProps) {
  const { colors, isGlass } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const pagerGestureLock = useMainPagerGestureLock()
  const setPagerGestureLocked = pagerGestureLock?.setLocked
  const insets = useSafeAreaInsets()
  const { height, width } = useWindowDimensions()
  const compact = width < 390
  const pageHorizontalPadding = compact ? 14 : 16
  const listHorizontalPadding = compact ? 14 : 20
  const scrollTopActionBottom = Math.max(insets.bottom, 10) + 18
  const listSafeBottomPadding = Math.max(insets.bottom, 10) + 18
  const scrollTopListBottomPadding = scrollTopActionBottom + SCROLL_TOP_ACTION_SIZE + SCROLL_TOP_ACTION_CLEARANCE
  const primaryActionSize = compact ? 46 : 50
  const currentConversationActionWidth = Math.max(SCROLL_TOP_ACTION_SIZE, Math.min(width - listHorizontalPadding * 2, compact ? 176 : 206))
  const searchHorizontalPadding = compact ? 12 : 14
  const subtleBorderWidth = colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth
  const chromeIconSurface = colors.ui.cartoon ? colors.ui.semantic.surface.muted : isGlass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted
  const chromeIconBorder = colors.ui.cartoon ? colors.material.stroke : colors.ui.semantic.chrome.border
  const searchShellBackground = isGlass ? colors.ui.semantic.chrome.background : colors.ui.cartoon ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.muted
  const searchShellBorder = isGlass ? colors.ui.semantic.chrome.border : colors.ui.cartoon ? colors.ui.input.border : colors.ui.semantic.chrome.border
  const floatingSecondarySurface = isGlass ? colors.ui.actionBar.itemBackground : colors.ui.cartoon ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.muted
  const floatingSecondaryBorder = colors.ui.cartoon ? colors.material.strokeStrong : colors.ui.semantic.chrome.border
  const floatingSecondaryShadowOpacity = colors.ui.cartoon ? Math.min(colors.ui.card.shadowOpacity, 0.08) : 0
  const floatingSecondaryShadowRadius = colors.ui.cartoon ? Math.max(2, colors.ui.card.shadowRadius - 4) : 0
  const floatingSecondaryShadowOffset = colors.ui.cartoon ? Math.max(1, colors.ui.card.shadowOffset - 2) : 0
  const conversations = useChatStore((state) => state.conversations)
  const currentId = useChatStore((state) => state.currentId)
  const create = useChatStore((state) => state.create)
  const select = useChatStore((state) => state.select)
  const settings = useSettingsStore((state) => state.settings)
  const providers = useSettingsStore((state) => state.providers)
  const getPrimaryConfiguredProvider = useSettingsStore((state) => state.getPrimaryConfiguredProvider)
  const listRef = useRef<FlashListRef<Conversation>>(null)
  const searchInputRef = useRef<TextInput>(null)
  const scrollTopActionVisible = useRef(false)
  const scrollTopActionLockTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollTopActionLockedRef = useRef(false)
  const currentConversationActionVisible = useRef(false)
  const currentConversationActionLockTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentConversationActionLockedRef = useRef(false)
  const scrollToIndexRetry = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeConversationScrollFrame = useRef<ReturnType<typeof requestAnimationFrame> | null>(null)
  const currentConversationVisibilityFrame = useRef<ReturnType<typeof requestAnimationFrame> | null>(null)
  const searchResetFrame = useRef<ReturnType<typeof requestAnimationFrame> | null>(null)
  const searchResetKeyRef = useRef('')
  const lastNonSearchScrollOffsetRef = useRef(0)
  const searchReturnScrollOffsetRef = useRef<number | null>(null)
  const searchWasActiveRef = useRef(false)
  const pendingSearchSubmitRef = useRef<{ normalized: string; label: string } | null>(null)
  const renameFocusFrame = useRef<ReturnType<typeof requestAnimationFrame> | null>(null)
  const listInteractionReleaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listInteractionFailsafeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listTouchPagerGestureReleaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listInteractionActiveRef = useRef(false)
  const pagerGestureLockedByHistoryRef = useRef(false)
  const persistentPagerGestureLockRef = useRef(false)
  const historyWasActiveRef = useRef(false)
  const currentConversationRevealPendingRef = useRef(false)
  const viewableConversationIdsRef = useRef<Set<string> | null>(null)
  const conversationRowHeightsRef = useRef(new Map<string, number>())
  const conversationRowHeightVersionRef = useRef(0)
  const conversationListOffsetCacheRef = useRef(new Map<string, number[]>())
  const listInteractionGuardUntilRef = useRef(0)
  const listInteractionReleaseGuardMsRef = useRef(LIST_TAP_AFTER_USER_SCROLL_GUARD_MS)
  const lastBlockedFeedbackAtRef = useRef(0)
  const pendingRelativeTimeRefreshRef = useRef(false)
  const creatingConversationRef = useRef(false)
  const mountedRef = useRef(true)
  const [query, setQuery] = useState('')
  const [showScrollTopAction, setShowScrollTopAction] = useState(false)
  const [scrollTopActionLocked, setScrollTopActionLocked] = useState(false)
  const [showCurrentConversationAction, setShowCurrentConversationAction] = useState(false)
  const [currentConversationActionLocked, setCurrentConversationActionLocked] = useState(false)
  const [creatingConversation, setCreatingConversation] = useState(false)
  const [searchInputFocused, setSearchInputFocused] = useState(false)
  const [visibleConversationRange, setVisibleConversationRange] = useState<VisibleConversationRange | null>(null)
  const [relativeTimeNow, setRelativeTimeNow] = useState(() => Date.now())
  const newConversationLabel = t('chat.newConversation')
  const deferredQuery = useDeferredValue(query)
  const trimmedQuery = query.trim()
  const hasRawSearchInput = query.length > 0
  const hasSearchInput = trimmedQuery.length > 0
  const searchActive = hasSearchInput
  const reserveScrollTopActionSpace = !hasSearchInput && (showScrollTopAction || lastNonSearchScrollOffsetRef.current > SCROLL_TOP_ACTION_OFFSET)
  const reserveCurrentConversationActionSpace = !hasSearchInput && showCurrentConversationAction
  const floatingHistoryActionCount = (reserveScrollTopActionSpace ? 1 : 0) + (reserveCurrentConversationActionSpace ? 1 : 0)
  const floatingHistoryActionBottomPadding = floatingHistoryActionCount > 0
    ? scrollTopActionBottom + (SCROLL_TOP_ACTION_SIZE * floatingHistoryActionCount) + (FLOATING_HISTORY_ACTION_GAP * Math.max(0, floatingHistoryActionCount - 1)) + SCROLL_TOP_ACTION_CLEARANCE
    : listSafeBottomPadding
  const listBottomPadding = Math.max(listSafeBottomPadding, floatingHistoryActionBottomPadding)
  const listMaintainVisibleContentPosition = useMemo(
    () => searchActive ? undefined : { minIndexForVisible: 0, autoscrollToTopThreshold: SCROLL_TOP_ACTION_OFFSET },
    [searchActive]
  )
  const listViewabilityConfig = useMemo(
    () => ({ itemVisiblePercentThreshold: CONVERSATION_VIEWABILITY_VISIBLE_PERCENT }),
    []
  )
  const normalizedQuery = useMemo(() => normalizeSearchText(trimmedQuery), [trimmedQuery])
  const deferredNormalizedQuery = useMemo(
    () => searchActive ? normalizeSearchText(deferredQuery) : '',
    [deferredQuery, searchActive]
  )
  const deferredSearchReady = deferredNormalizedQuery.length > 0
  const searchPending = searchActive && deferredNormalizedQuery !== normalizedQuery
  const providerById = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider] as const)),
    [providers]
  )
  const modelLabelByConversationId = useMemo(
    () => new Map(conversations.map((conversation) => [
      conversation.id,
      getProviderDisplayModel(providerById.get(conversation.providerId), conversation.model),
    ] as const)),
    [conversations, providerById]
  )
  const conversationSearchIndexState = useMemo<ConversationSearchIndexState>(
    () => {
      if (!deferredSearchReady) return { index: [], source: null }
      return {
        index: conversations.map((conversation) => buildConversationSearchIndexItem(conversation, providerById)),
        source: conversations,
      }
    },
    [conversations, deferredSearchReady, providerById]
  )
  const conversationSearchIndex = conversationSearchIndexState.index
  const { filteredConversations, searchMatchByConversationId } = useMemo(() => {
    const searchMatches = new Map<string, ConversationSearchMatchPresentation>()
    if (!deferredNormalizedQuery) return { filteredConversations: conversations, searchMatchByConversationId: searchMatches }
    const searchResults = getRankedConversationSearchResults(conversationSearchIndex, deferredNormalizedQuery)
    for (const result of searchResults) {
      const fieldLabel = t(conversationSearchFieldLabelKey(result.match.key))
      const preview = summarizeConversationSearchMatch(result.match, deferredNormalizedQuery)
      searchMatches.set(result.conversation.id, {
        preview,
        fieldLabel,
        accessibilitySummary: t('conversation.searchMatchSummary', {
          field: fieldLabel,
          value: preview,
        }),
      })
    }
    return {
      filteredConversations: searchResults.map((result) => result.conversation),
      searchMatchByConversationId: searchMatches,
    }
  }, [conversationSearchIndex, conversations, deferredNormalizedQuery, t])
  const conversationEntranceAnimationEnabled =
    !searchActive &&
    !searchPending &&
    conversations.length > 0 &&
    conversations.length <= LIST_ENTRANCE_ANIMATION_MAX_COUNT
  const conversationListExtraData = useMemo(
    () => ({ currentId, relativeTimeNow, searchActive, searchMatchByConversationId, searchPending }),
    [currentId, relativeTimeNow, searchActive, searchMatchByConversationId, searchPending]
  )
  const currentConversationIndex = useMemo(
    () => currentId ? conversations.findIndex((conversation) => conversation.id === currentId) : -1,
    [conversations, currentId]
  )
  const currentSearchResultIndex = useMemo(
    () => searchActive && !searchPending && currentId
      ? filteredConversations.findIndex((conversation) => conversation.id === currentId)
      : -1,
    [currentId, filteredConversations, searchActive, searchPending]
  )
  const currentConversationPositionLabel = currentConversationIndex >= 0
    ? t('conversation.currentConversationPosition', { current: currentConversationIndex + 1, total: conversations.length })
    : ''
  const currentConversationActionPositionLabel = currentConversationIndex >= 0
    ? t('conversation.currentConversationActionPosition', { current: currentConversationIndex + 1, total: conversations.length })
    : ''
  const visibleConversationRangeLabel = visibleConversationRange &&
    !searchPending &&
    visibleConversationRange.total === filteredConversations.length &&
    visibleConversationRange.searchActive === searchActive &&
    filteredConversations.length >= LIST_END_FEEDBACK_MIN_COUNT
    ? t(searchActive ? 'conversation.visibleSearchResultRange' : 'conversation.visibleConversationRange', {
      start: visibleConversationRange.start,
      end: visibleConversationRange.end,
      total: filteredConversations.length,
    })
    : ''
  const listSummaryLabel = searchActive
    ? searchPending
      ? t('conversation.searchPendingForQuery', { query: trimmedQuery })
      : t('conversation.searchResultCountForQuery', { query: trimmedQuery, count: filteredConversations.length, total: conversations.length })
    : conversations.length
      ? currentConversationIndex >= 0
        ? t('conversation.historyCountWithCurrent', { count: conversations.length, current: currentConversationIndex + 1 })
        : t('conversation.historyCount', { count: conversations.length })
      : ''
  const currentSearchConversationLabel = searchActive && !searchPending && currentId
    ? currentSearchResultIndex >= 0
      ? t('conversation.searchCurrentMatchPosition', { current: currentSearchResultIndex + 1 })
      : t('conversation.searchCurrentNotMatched')
    : ''
  const listSummaryDisplayLabel = [listSummaryLabel, visibleConversationRangeLabel, currentSearchConversationLabel].filter(Boolean).join(' · ')
  const listSummaryAccessibilityLabel = [listSummaryLabel, currentSearchConversationLabel].filter(Boolean).join(' · ')
  const searchInputAccessibilityValue = searchActive && listSummaryDisplayLabel ? { text: listSummaryDisplayLabel } : undefined
  const listAccessibilityValue = listSummaryDisplayLabel ? { text: listSummaryDisplayLabel } : undefined
  const listAccessibilityState = searchPending ? { busy: true } : undefined
  const listFooterLabel = useMemo(() => {
    if (searchPending || filteredConversations.length < LIST_END_FEEDBACK_MIN_COUNT) return ''
    return searchActive
      ? t('conversation.searchResultsEnd', { count: filteredConversations.length })
      : t('conversation.historyEnd', { count: conversations.length })
  }, [conversations.length, filteredConversations.length, searchActive, searchPending, t])
  const listFooter = useMemo(() => {
    if (!listFooterLabel) return null
    return (
      <View style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 2, paddingHorizontal: 16 }}>
        <Text
          style={{
            color: colors.textTertiary,
            fontSize: 12,
            lineHeight: 16,
            fontWeight: '800',
            textAlign: 'center',
          }}
        >
          {listFooterLabel}
        </Text>
      </View>
    )
  }, [colors.textTertiary, listFooterLabel])
  const conversationOffsetCacheKey = useMemo(
    () => conversations.map((conversation) => conversation.id).join('|'),
    [conversations]
  )
  const filteredConversationOffsetCacheKey = useMemo(
    () => filteredConversations.map((conversation) => conversation.id).join('|'),
    [filteredConversations]
  )
  const scrollTopActionAvailable = showScrollTopAction && !searchInputFocused && !hasSearchInput
  const scrollTopActionAccessibilityState = scrollTopActionLocked
    ? { busy: true, disabled: true }
    : undefined
  const scrollTopActionAccessibilityHint = scrollTopActionLocked
    ? t('common.scrollToTopInProgressHint')
    : t('common.scrollToTopHint')
  const currentConversationActionAvailable = showCurrentConversationAction && !searchInputFocused && !hasSearchInput && currentConversationIndex >= 0
  const currentConversationActionAccessibilityState = currentConversationActionLocked
    ? { busy: true, disabled: true }
    : undefined
  const currentConversationActionAccessibilityHint = currentConversationActionLocked
    ? t('conversation.scrollToCurrentInProgressHint')
    : t('conversation.scrollToCurrentHint')
  const currentConversationActionAccessibilityValue = currentConversationPositionLabel
    ? { text: currentConversationPositionLabel }
    : undefined
  const firstSearchResultActionHasMatch = hasSearchInput && !searchPending && filteredConversations.length > 0
  const firstSearchResultActionDisabled = hasSearchInput && searchPending
  const firstSearchResultActionAccessibilityLabel = firstSearchResultActionDisabled
    ? t('conversation.searchPendingForQuery', { query: trimmedQuery })
    : firstSearchResultActionHasMatch
      ? t('conversation.openFirstSearchResult')
      : t('conversation.openFirstSearchResultNoMatch')
  const firstSearchResultActionAccessibilityHint = firstSearchResultActionDisabled
    ? t('conversation.openFirstSearchResultWaitingHint')
    : firstSearchResultActionHasMatch
      ? t('conversation.openFirstSearchResultHint')
      : t('conversation.openFirstSearchResultNoMatchHint')
  const firstSearchResultActionAccessibilityValue = listSummaryDisplayLabel
    ? { text: listSummaryDisplayLabel }
    : undefined

  const clearScrollToIndexRetry = useCallback(() => {
    if (scrollToIndexRetry.current) clearTimeout(scrollToIndexRetry.current)
    scrollToIndexRetry.current = null
  }, [])

  const clearSearchResetFrame = useCallback(() => {
    if (searchResetFrame.current !== null) cancelAnimationFrame(searchResetFrame.current)
    searchResetFrame.current = null
  }, [])

  const conversationRowHeightCacheKey = useCallback((conversationId: string, searchMode = searchActive) => (
    `${searchMode ? CONVERSATION_ROW_HEIGHT_CACHE_PREFIX_SEARCH : CONVERSATION_ROW_HEIGHT_CACHE_PREFIX_DEFAULT}:${conversationId}`
  ), [searchActive])

  const getMeasuredConversationRowHeight = useCallback((conversationId: string, fallbackHeight = CONVERSATION_ROW_ESTIMATED_HEIGHT, searchMode = searchActive) => {
    const primaryHeight = conversationRowHeightsRef.current.get(conversationRowHeightCacheKey(conversationId, searchMode))
    if (primaryHeight !== undefined) return primaryHeight
    if (searchMode) {
      const defaultHeight = conversationRowHeightsRef.current.get(conversationRowHeightCacheKey(conversationId, false))
      if (defaultHeight !== undefined) return defaultHeight
    }
    return fallbackHeight
  }, [conversationRowHeightCacheKey, searchActive])

  const estimateConversationListOffset = useCallback((items: Conversation[], index: number, averageItemLength = CONVERSATION_ROW_ESTIMATED_HEIGHT, cacheSignature = conversationOffsetCacheKey, searchMode = searchActive) => {
    const fallbackHeight = Number.isFinite(averageItemLength) && averageItemLength > 0
      ? averageItemLength
      : CONVERSATION_ROW_ESTIMATED_HEIGHT
    const boundedIndex = Math.max(0, Math.floor(index))
    const offsetCacheKey = `${searchMode ? CONVERSATION_ROW_HEIGHT_CACHE_PREFIX_SEARCH : CONVERSATION_ROW_HEIGHT_CACHE_PREFIX_DEFAULT}:${conversationRowHeightVersionRef.current}:${Math.round(fallbackHeight)}:${cacheSignature}`
    let offsets = conversationListOffsetCacheRef.current.get(offsetCacheKey)
    if (!offsets) {
      offsets = [0]
      for (let rowIndex = 0; rowIndex < items.length; rowIndex += 1) {
        const conversation = items[rowIndex]
        const previousOffset = offsets[rowIndex] ?? 0
        offsets.push(previousOffset + (conversation ? getMeasuredConversationRowHeight(conversation.id, fallbackHeight, searchMode) : fallbackHeight))
      }
      conversationListOffsetCacheRef.current.clear()
      conversationListOffsetCacheRef.current.set(offsetCacheKey, offsets)
    }
    if (boundedIndex <= items.length) return Math.max(0, Math.floor(offsets[boundedIndex] ?? 0))
    const measuredOffset = offsets[items.length] ?? 0
    return Math.max(0, Math.floor(measuredOffset + (boundedIndex - items.length) * fallbackHeight))
  }, [conversationOffsetCacheKey, getMeasuredConversationRowHeight, searchActive])

  const getConversationListItemLayout = useCallback((_data: ArrayLike<Conversation> | null | undefined, index: number) => {
    const boundedIndex = Math.max(0, Math.floor(index))
    const conversation = filteredConversations[boundedIndex]
    const length = conversation
      ? getMeasuredConversationRowHeight(conversation.id, CONVERSATION_ROW_ESTIMATED_HEIGHT, searchActive)
      : CONVERSATION_ROW_ESTIMATED_HEIGHT
    return {
      length,
      offset: estimateConversationListOffset(
        filteredConversations,
        boundedIndex,
        CONVERSATION_ROW_ESTIMATED_HEIGHT,
        filteredConversationOffsetCacheKey,
        searchActive
      ),
      index: boundedIndex,
    }
  }, [estimateConversationListOffset, filteredConversationOffsetCacheKey, filteredConversations, getMeasuredConversationRowHeight, searchActive])

  const handleConversationRowLayout = useCallback((conversationId: string, height: number) => {
    const measuredHeight = Math.ceil(height)
    if (!Number.isFinite(measuredHeight) || measuredHeight <= 0) return
    const cacheKey = conversationRowHeightCacheKey(conversationId)
    if (conversationRowHeightsRef.current.get(cacheKey) === measuredHeight) return
    conversationRowHeightsRef.current.set(cacheKey, measuredHeight)
    conversationRowHeightVersionRef.current += 1
    conversationListOffsetCacheRef.current.clear()
  }, [conversationRowHeightCacheKey])

  const clearActiveConversationScrollFrame = useCallback(() => {
    if (activeConversationScrollFrame.current !== null) cancelAnimationFrame(activeConversationScrollFrame.current)
    activeConversationScrollFrame.current = null
  }, [])

  const clearCurrentConversationVisibilityFrame = useCallback(() => {
    if (currentConversationVisibilityFrame.current !== null) cancelAnimationFrame(currentConversationVisibilityFrame.current)
    currentConversationVisibilityFrame.current = null
  }, [])

  const clearRenameFocusFrame = useCallback(() => {
    if (renameFocusFrame.current !== null) cancelAnimationFrame(renameFocusFrame.current)
    renameFocusFrame.current = null
  }, [])

  const clearListInteractionReleaseTimer = useCallback(() => {
    if (listInteractionReleaseTimer.current) clearTimeout(listInteractionReleaseTimer.current)
    listInteractionReleaseTimer.current = null
  }, [])

  const clearListInteractionFailsafeTimer = useCallback(() => {
    if (listInteractionFailsafeTimer.current) clearTimeout(listInteractionFailsafeTimer.current)
    listInteractionFailsafeTimer.current = null
  }, [])

  const clearListTouchPagerGestureReleaseTimer = useCallback(() => {
    if (listTouchPagerGestureReleaseTimer.current) clearTimeout(listTouchPagerGestureReleaseTimer.current)
    listTouchPagerGestureReleaseTimer.current = null
  }, [])

  const clearScrollTopActionLock = useCallback(() => {
    if (scrollTopActionLockTimer.current) {
      clearTimeout(scrollTopActionLockTimer.current)
      scrollTopActionLockTimer.current = null
    }
    scrollTopActionLockedRef.current = false
    setScrollTopActionLocked(false)
  }, [])

  const lockScrollTopAction = useCallback(() => {
    if (scrollTopActionLockTimer.current) clearTimeout(scrollTopActionLockTimer.current)
    scrollTopActionLockedRef.current = true
    setScrollTopActionLocked(true)
    scrollTopActionLockTimer.current = setTimeout(() => {
      scrollTopActionLockTimer.current = null
      scrollTopActionLockedRef.current = false
      setScrollTopActionLocked(false)
    }, SCROLL_TOP_ACTION_LOCK_MS)
  }, [])

  const clearCurrentConversationActionLock = useCallback(() => {
    if (currentConversationActionLockTimer.current) {
      clearTimeout(currentConversationActionLockTimer.current)
      currentConversationActionLockTimer.current = null
    }
    currentConversationActionLockedRef.current = false
    setCurrentConversationActionLocked(false)
  }, [])

  const lockCurrentConversationAction = useCallback(() => {
    if (currentConversationActionLockTimer.current) clearTimeout(currentConversationActionLockTimer.current)
    currentConversationActionLockedRef.current = true
    setCurrentConversationActionLocked(true)
    currentConversationActionLockTimer.current = setTimeout(() => {
      currentConversationActionLockTimer.current = null
      currentConversationActionLockedRef.current = false
      setCurrentConversationActionLocked(false)
    }, CURRENT_CONVERSATION_ACTION_LOCK_MS)
  }, [])

  const setScrollTopActionVisibility = useCallback((visible: boolean) => {
    if (scrollTopActionVisible.current === visible) return
    scrollTopActionVisible.current = visible
    setShowScrollTopAction(visible)
  }, [])

  const setCurrentConversationActionVisibility = useCallback((visible: boolean) => {
    if (currentConversationActionVisible.current === visible) return
    currentConversationActionVisible.current = visible
    setShowCurrentConversationAction(visible)
  }, [])

  const lockPagerGestureForHistory = useCallback(() => {
    if (!active || pagerGestureLockedByHistoryRef.current) return
    pagerGestureLockedByHistoryRef.current = true
    setPagerGestureLocked?.(true)
  }, [active, setPagerGestureLocked])

  const releasePagerGestureForHistory = useCallback(() => {
    if (!pagerGestureLockedByHistoryRef.current) return
    pagerGestureLockedByHistoryRef.current = false
    setPagerGestureLocked?.(false)
  }, [setPagerGestureLocked])

  const scheduleTouchPagerGestureRelease = useCallback(() => {
    clearListTouchPagerGestureReleaseTimer()
    listTouchPagerGestureReleaseTimer.current = setTimeout(() => {
      listTouchPagerGestureReleaseTimer.current = null
      if (listInteractionActiveRef.current || persistentPagerGestureLockRef.current) return
      releasePagerGestureForHistory()
    }, LIST_TOUCH_PAGER_GESTURE_RELEASE_DELAY_MS)
  }, [clearListTouchPagerGestureReleaseTimer, releasePagerGestureForHistory])

  const requestCurrentConversationReveal = useCallback(() => {
    currentConversationRevealPendingRef.current = true
    viewableConversationIdsRef.current = null
  }, [])

  const resetSearchAfterConversationOpen = useCallback(() => {
    clearSearchResetFrame()
    searchResetKeyRef.current = ''
    pendingSearchSubmitRef.current = null
    searchWasActiveRef.current = false
    searchReturnScrollOffsetRef.current = null
    setSearchInputFocused(false)
    setQuery('')
    setScrollTopActionVisibility(false)
  }, [clearSearchResetFrame, setScrollTopActionVisibility])

  const applyRelativeTimeRefresh = useCallback(() => {
    setRelativeTimeNow(Date.now())
  }, [])

  const requestRelativeTimeRefresh = useCallback(() => {
    if (listInteractionActiveRef.current) {
      pendingRelativeTimeRefreshRef.current = true
      return
    }
    applyRelativeTimeRefresh()
  }, [applyRelativeTimeRefresh])

  const flushPendingRelativeTimeRefresh = useCallback(() => {
    if (!pendingRelativeTimeRefreshRef.current) return
    pendingRelativeTimeRefreshRef.current = false
    applyRelativeTimeRefresh()
  }, [applyRelativeTimeRefresh])

  const releaseListInteraction = useCallback(() => {
    const releaseGuardMs = Math.max(0, listInteractionReleaseGuardMsRef.current)
    listInteractionGuardUntilRef.current = releaseGuardMs > 0 ? Date.now() + releaseGuardMs : 0
    listInteractionReleaseGuardMsRef.current = LIST_TAP_AFTER_USER_SCROLL_GUARD_MS
    clearListInteractionReleaseTimer()
    clearListInteractionFailsafeTimer()
    listInteractionActiveRef.current = false
    flushPendingRelativeTimeRefresh()
    if (!persistentPagerGestureLockRef.current) releasePagerGestureForHistory()
  }, [clearListInteractionFailsafeTimer, clearListInteractionReleaseTimer, flushPendingRelativeTimeRefresh, releasePagerGestureForHistory])

  const beginListInteraction = useCallback(() => {
    listInteractionGuardUntilRef.current = 0
    listInteractionReleaseGuardMsRef.current = LIST_TAP_AFTER_USER_SCROLL_GUARD_MS
    clearListInteractionReleaseTimer()
    clearListInteractionFailsafeTimer()
    listInteractionActiveRef.current = true
    lockPagerGestureForHistory()
    listInteractionFailsafeTimer.current = setTimeout(() => {
      listInteractionFailsafeTimer.current = null
      releaseListInteraction()
    }, LIST_INTERACTION_FAILSAFE_MS)
  }, [clearListInteractionFailsafeTimer, clearListInteractionReleaseTimer, lockPagerGestureForHistory, releaseListInteraction])

  const scheduleListInteractionRelease = useCallback(() => {
    clearListInteractionReleaseTimer()
    listInteractionReleaseTimer.current = setTimeout(() => {
      listInteractionReleaseTimer.current = null
      releaseListInteraction()
    }, RELATIVE_TIME_SCROLL_RELEASE_DELAY_MS)
  }, [clearListInteractionReleaseTimer, releaseListInteraction])

  const guardProgrammaticListScroll = useCallback(() => {
    listInteractionGuardUntilRef.current = 0
    listInteractionReleaseGuardMsRef.current = LIST_TAP_AFTER_PROGRAMMATIC_SCROLL_GUARD_MS
    clearListInteractionReleaseTimer()
    clearListInteractionFailsafeTimer()
    listInteractionActiveRef.current = true
    lockPagerGestureForHistory()
    listInteractionFailsafeTimer.current = setTimeout(() => {
      listInteractionFailsafeTimer.current = null
      releaseListInteraction()
    }, PROGRAMMATIC_LIST_SCROLL_GUARD_MS)
  }, [clearListInteractionFailsafeTimer, clearListInteractionReleaseTimer, lockPagerGestureForHistory, releaseListInteraction])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      listInteractionGuardUntilRef.current = 0
      clearScrollToIndexRetry()
      clearActiveConversationScrollFrame()
      clearCurrentConversationVisibilityFrame()
      clearSearchResetFrame()
      clearRenameFocusFrame()
      clearListInteractionReleaseTimer()
      clearListInteractionFailsafeTimer()
      clearListTouchPagerGestureReleaseTimer()
      clearScrollTopActionLock()
      clearCurrentConversationActionLock()
      persistentPagerGestureLockRef.current = false
      releasePagerGestureForHistory()
    }
  }, [clearActiveConversationScrollFrame, clearCurrentConversationActionLock, clearCurrentConversationVisibilityFrame, clearListInteractionFailsafeTimer, clearListInteractionReleaseTimer, clearListTouchPagerGestureReleaseTimer, clearScrollToIndexRetry, clearRenameFocusFrame, clearScrollTopActionLock, clearSearchResetFrame, releasePagerGestureForHistory])

  useEffect(() => {
    const conversationIds = new Set(conversations.map((conversation) => conversation.id))
    for (const key of conversationRowHeightsRef.current.keys()) {
      const separatorIndex = key.indexOf(':')
      const conversationId = separatorIndex >= 0 ? key.slice(separatorIndex + 1) : key
      if (!conversationIds.has(conversationId)) conversationRowHeightsRef.current.delete(key)
    }
  }, [conversations])

  useEffect(() => {
    if (!active) {
      persistentPagerGestureLockRef.current = false
      releasePagerGestureForHistory()
      return
    }
    persistentPagerGestureLockRef.current = searchInputFocused
    if (searchInputFocused) {
      lockPagerGestureForHistory()
      return
    }
    if (!listInteractionActiveRef.current) releasePagerGestureForHistory()
  }, [active, lockPagerGestureForHistory, releasePagerGestureForHistory, searchInputFocused])

  useEffect(() => {
    if (!conversations.length) return undefined
    requestRelativeTimeRefresh()
    const timer = setInterval(requestRelativeTimeRefresh, RELATIVE_TIME_REFRESH_MS)
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') requestRelativeTimeRefresh()
    })
    return () => {
      clearInterval(timer)
      appStateSubscription.remove()
    }
  }, [conversations.length, requestRelativeTimeRefresh])

  const createConversation = useCallback(async () => {
    if (creatingConversationRef.current) return
    Keyboard.dismiss()
    setSearchInputFocused(false)
    creatingConversationRef.current = true
    setCreatingConversation(true)
    try {
      const provider = await getPrimaryConfiguredProvider()
      const model = provider ? getPolicyPreferredProviderModel(provider, settings) : undefined
      if (!provider || !model) {
        dialog.toast({
          title: provider ? t('chat.noAvailableModels') : t('chat.noProviderConnected'),
          message: provider ? t('chat.syncModelsBeforeChat') : t('chat.configureProviderBeforeChat'),
          tone: 'amber',
          position: 'bottom',
          durationMs: 3600,
        })
        if (onSettings) onSettings()
        else router.push('/settings')
        return
      }
      const id = create(provider.id, model)
      select(id)
      requestCurrentConversationReveal()
      if (hasRawSearchInput) resetSearchAfterConversationOpen()
      if (onHome) onHome()
      else router.push('/')
    } finally {
      creatingConversationRef.current = false
      if (mountedRef.current) setCreatingConversation(false)
    }
  }, [create, dialog, getPrimaryConfiguredProvider, hasRawSearchInput, onHome, onSettings, requestCurrentConversationReveal, resetSearchAfterConversationOpen, select, settings, t])

  const openConversation = useCallback((id: string) => {
    Keyboard.dismiss()
    setSearchInputFocused(false)
    select(id)
    if (hasRawSearchInput) requestCurrentConversationReveal()
    if (hasRawSearchInput) resetSearchAfterConversationOpen()
    if (onHome) onHome()
    else router.push({ pathname: '/chat/[id]', params: { id } })
  }, [hasRawSearchInput, onHome, requestCurrentConversationReveal, resetSearchAfterConversationOpen, select])

  const keepRenameInputVisible = useCallback((index: number) => {
    clearRenameFocusFrame()
    renameFocusFrame.current = requestAnimationFrame(() => {
      renameFocusFrame.current = null
      guardProgrammaticListScroll()
      listRef.current?.scrollToIndex({ index, viewPosition: 0.32, animated: true })
    })
  }, [clearRenameFocusFrame, guardProgrammaticListScroll])

  const scheduleScrollToIndexRetry = useCallback((index: number, averageItemLength: number) => {
    clearScrollToIndexRetry()
    const approximateOffset = estimateConversationListOffset(filteredConversations, index, averageItemLength, filteredConversationOffsetCacheKey, searchActive)
    guardProgrammaticListScroll()
    listRef.current?.scrollToOffset({ offset: approximateOffset, animated: true })
    scrollToIndexRetry.current = setTimeout(() => {
      scrollToIndexRetry.current = null
      guardProgrammaticListScroll()
      listRef.current?.scrollToIndex({ index, viewPosition: 0.32, animated: true })
    }, RENAME_SCROLL_RETRY_DELAY_MS)
  }, [clearScrollToIndexRetry, estimateConversationListOffset, filteredConversationOffsetCacheKey, filteredConversations, guardProgrammaticListScroll, searchActive])

  const scrollConversationIndexIntoView = useCallback((index: number) => {
    clearActiveConversationScrollFrame()
    activeConversationScrollFrame.current = requestAnimationFrame(() => {
      activeConversationScrollFrame.current = null
      guardProgrammaticListScroll()
      listRef.current?.scrollToIndex({
        index,
        viewPosition: CURRENT_CONVERSATION_SCROLL_VIEW_POSITION,
        animated: true,
      })
    })
  }, [clearActiveConversationScrollFrame, guardProgrammaticListScroll])

  const isConversationIndexLikelyVisible = useCallback((index: number) => {
    if (index < 0) return false
    const currentConversation = conversations[index]
    if (currentConversation && viewableConversationIdsRef.current) {
      return viewableConversationIdsRef.current.has(currentConversation.id)
    }
    const viewportHeight = Math.max(160, height - CONVERSATION_LIST_RESERVED_HEIGHT - insets.bottom)
    const scrollOffset = lastNonSearchScrollOffsetRef.current
    const rowTop = estimateConversationListOffset(conversations, index)
    const rowBottom = rowTop + (currentConversation ? getMeasuredConversationRowHeight(currentConversation.id) : CONVERSATION_ROW_ESTIMATED_HEIGHT)
    return (
      rowBottom >= scrollOffset + CURRENT_CONVERSATION_VISIBLE_MARGIN &&
      rowTop <= scrollOffset + viewportHeight - CURRENT_CONVERSATION_VISIBLE_MARGIN
    )
  }, [conversations, estimateConversationListOffset, getMeasuredConversationRowHeight, height, insets.bottom])

  const syncCurrentConversationActionVisibility = useCallback(() => {
    const visible = (
      active &&
      !searchActive &&
      !searchPending &&
      currentConversationIndex >= 0 &&
      !isConversationIndexLikelyVisible(currentConversationIndex)
    )
    setCurrentConversationActionVisibility(visible)
    if (!visible && currentConversationActionLockedRef.current) clearCurrentConversationActionLock()
  }, [active, clearCurrentConversationActionLock, currentConversationIndex, isConversationIndexLikelyVisible, searchActive, searchPending, setCurrentConversationActionVisibility])

  const scheduleCurrentConversationActionVisibilitySync = useCallback(() => {
    if (currentConversationVisibilityFrame.current !== null) return
    currentConversationVisibilityFrame.current = requestAnimationFrame(() => {
      currentConversationVisibilityFrame.current = null
      syncCurrentConversationActionVisibility()
    })
  }, [syncCurrentConversationActionVisibility])

  const scrollListToOffset = useCallback((offset: number, animated = false) => {
    const targetOffset = Math.max(0, Math.floor(offset))
    clearRenameFocusFrame()
    clearScrollToIndexRetry()
    if (animated) guardProgrammaticListScroll()
    if (!searchActive) lastNonSearchScrollOffsetRef.current = targetOffset
    listRef.current?.scrollToOffset({ offset: targetOffset, animated })
    setScrollTopActionVisibility(targetOffset > SCROLL_TOP_ACTION_OFFSET)
    syncCurrentConversationActionVisibility()
  }, [clearRenameFocusFrame, clearScrollToIndexRetry, guardProgrammaticListScroll, searchActive, setScrollTopActionVisibility, syncCurrentConversationActionVisibility])

  const scheduleListScrollToOffset = useCallback((offset: number) => {
    clearSearchResetFrame()
    searchResetFrame.current = requestAnimationFrame(() => {
      searchResetFrame.current = null
      guardProgrammaticListScroll()
      scrollListToOffset(offset, false)
    })
  }, [clearSearchResetFrame, guardProgrammaticListScroll, scrollListToOffset])

  const scheduleListResetToTop = useCallback(() => {
    scheduleListScrollToOffset(0)
  }, [scheduleListScrollToOffset])

  const captureSearchReturnScrollOffset = useCallback(() => {
    if (searchReturnScrollOffsetRef.current !== null) return
    searchReturnScrollOffsetRef.current = lastNonSearchScrollOffsetRef.current
  }, [])

  useEffect(() => {
    if (!deferredNormalizedQuery) {
      searchResetKeyRef.current = ''
      return
    }
    if (searchResetKeyRef.current === deferredNormalizedQuery) return
    searchResetKeyRef.current = deferredNormalizedQuery
    scheduleListResetToTop()
  }, [deferredNormalizedQuery, scheduleListResetToTop])

  useEffect(() => {
    viewableConversationIdsRef.current = null
    syncCurrentConversationActionVisibility()
  }, [currentId, filteredConversations, searchActive, syncCurrentConversationActionVisibility])

  useEffect(() => {
    if (searchActive) {
      clearCurrentConversationVisibilityFrame()
      setScrollTopActionVisibility(false)
      setCurrentConversationActionVisibility(false)
      clearCurrentConversationActionLock()
      return
    }
    syncCurrentConversationActionVisibility()
  }, [clearCurrentConversationActionLock, clearCurrentConversationVisibilityFrame, searchActive, setCurrentConversationActionVisibility, setScrollTopActionVisibility, syncCurrentConversationActionVisibility])

  useEffect(() => {
    if (searchActive) {
      if (!searchWasActiveRef.current) captureSearchReturnScrollOffset()
      searchWasActiveRef.current = true
      return
    }
    if (!searchWasActiveRef.current) return
    const returnOffset = searchReturnScrollOffsetRef.current
    searchWasActiveRef.current = false
    searchReturnScrollOffsetRef.current = null
    if (returnOffset !== null) scheduleListScrollToOffset(returnOffset)
  }, [captureSearchReturnScrollOffset, scheduleListScrollToOffset, searchActive])

  useEffect(() => {
    const becameActive = active && !historyWasActiveRef.current
    historyWasActiveRef.current = active
    if (!active) {
      clearActiveConversationScrollFrame()
      return
    }
    const revealPending = currentConversationRevealPendingRef.current
    if (!becameActive && !revealPending) return
    if (
      searchActive ||
      searchPending ||
      currentConversationIndex < 0 ||
      listInteractionActiveRef.current ||
      (!revealPending && (
        currentConversationIndex < 0 ||
        isConversationIndexLikelyVisible(currentConversationIndex)
      ))
    ) return
    currentConversationRevealPendingRef.current = false
    scrollConversationIndexIntoView(currentConversationIndex)
  }, [active, clearActiveConversationScrollFrame, currentConversationIndex, isConversationIndexLikelyVisible, scrollConversationIndexIntoView, searchActive, searchPending])

  const handleSearchChange = useCallback((value: string) => {
    clearCurrentConversationVisibilityFrame()
    pendingSearchSubmitRef.current = null
    if (value.trim().length > 0 && !searchWasActiveRef.current) captureSearchReturnScrollOffset()
    setQuery(value)
  }, [captureSearchReturnScrollOffset, clearCurrentConversationVisibilityFrame])

  const handleSearchFocus = useCallback(() => {
    clearCurrentConversationVisibilityFrame()
    setSearchInputFocused(true)
    setScrollTopActionVisibility(false)
    setCurrentConversationActionVisibility(false)
  }, [clearCurrentConversationVisibilityFrame, setCurrentConversationActionVisibility, setScrollTopActionVisibility])

  const handleSearchBlur = useCallback(() => {
    setSearchInputFocused(false)
    setScrollTopActionVisibility(!hasSearchInput && lastNonSearchScrollOffsetRef.current > SCROLL_TOP_ACTION_OFFSET)
    if (!hasSearchInput) syncCurrentConversationActionVisibility()
  }, [hasSearchInput, setScrollTopActionVisibility, syncCurrentConversationActionVisibility])

  const clearSearch = useCallback(() => {
    clearSearchResetFrame()
    searchResetKeyRef.current = ''
    pendingSearchSubmitRef.current = null
    const returnOffset = searchReturnScrollOffsetRef.current
    setQuery('')
    setSearchInputFocused(true)
    searchInputRef.current?.focus()
    if (!searchWasActiveRef.current && returnOffset !== null) {
      searchReturnScrollOffsetRef.current = null
      scheduleListScrollToOffset(returnOffset)
      return
    }
    if (!searchWasActiveRef.current) {
      setScrollTopActionVisibility(lastNonSearchScrollOffsetRef.current > SCROLL_TOP_ACTION_OFFSET)
      syncCurrentConversationActionVisibility()
    }
  }, [clearSearchResetFrame, scheduleListScrollToOffset, setScrollTopActionVisibility, syncCurrentConversationActionVisibility])

  const handleListScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = event.nativeEvent.contentOffset.y
    if (!searchActive) lastNonSearchScrollOffsetRef.current = Math.max(0, offset)
    if (offset <= 12 && scrollTopActionLockedRef.current) clearScrollTopActionLock()
    setScrollTopActionVisibility(!searchActive && offset > SCROLL_TOP_ACTION_OFFSET)
    if (!searchActive) scheduleCurrentConversationActionVisibilitySync()
  }, [clearScrollTopActionLock, scheduleCurrentConversationActionVisibilitySync, searchActive, setScrollTopActionVisibility])

  const handleListTouchStart = useCallback(() => {
    clearListTouchPagerGestureReleaseTimer()
    lockPagerGestureForHistory()
  }, [clearListTouchPagerGestureReleaseTimer, lockPagerGestureForHistory])

  const handleListTouchEnd = useCallback(() => {
    scheduleTouchPagerGestureRelease()
  }, [scheduleTouchPagerGestureRelease])

  const handleListScrollBeginDrag = useCallback(() => {
    beginListInteraction()
  }, [beginListInteraction])

  const handleListScrollEndDrag = useCallback(() => {
    scheduleListInteractionRelease()
  }, [scheduleListInteractionRelease])

  const handleListMomentumScrollBegin = useCallback(() => {
    beginListInteraction()
  }, [beginListInteraction])

  const handleListMomentumScrollEnd = useCallback(() => {
    releaseListInteraction()
  }, [releaseListInteraction])

  const handleListViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<Conversation>[] }) => {
    viewableConversationIdsRef.current = new Set(viewableItems.map((item) => item.item.id))
    const visibleIndices = viewableItems
      .map((item) => item.index)
      .filter((index): index is number => typeof index === 'number' && Number.isFinite(index) && index >= 0)
    if (visibleIndices.length) {
      const nextRange = {
        start: Math.min(...visibleIndices) + 1,
        end: Math.max(...visibleIndices) + 1,
        total: filteredConversations.length,
        searchActive,
      }
      setVisibleConversationRange((current) => (
        current &&
        current.start === nextRange.start &&
        current.end === nextRange.end &&
        current.total === nextRange.total &&
        current.searchActive === nextRange.searchActive
          ? current
          : nextRange
      ))
    } else {
      setVisibleConversationRange(null)
    }
    syncCurrentConversationActionVisibility()
  }, [filteredConversations.length, searchActive, syncCurrentConversationActionVisibility])

  const scrollToTop = useCallback(() => {
    if (scrollTopActionLockedRef.current) return
    lockScrollTopAction()
    scrollListToOffset(0, true)
  }, [lockScrollTopAction, scrollListToOffset])

  const scrollToCurrentConversation = useCallback(() => {
    if (currentConversationActionLockedRef.current || currentConversationIndex < 0) return
    lockCurrentConversationAction()
    scrollConversationIndexIntoView(currentConversationIndex)
  }, [currentConversationIndex, lockCurrentConversationAction, scrollConversationIndexIntoView])

  const isListInteractionBlocked = useCallback(() => (
    searchPending ||
    listInteractionActiveRef.current ||
    Date.now() < listInteractionGuardUntilRef.current
  ), [searchPending])

  const showListInteractionBlockedFeedback = useCallback(() => {
    const now = Date.now()
    if (now - lastBlockedFeedbackAtRef.current < LIST_BLOCKED_FEEDBACK_THROTTLE_MS) return
    lastBlockedFeedbackAtRef.current = now
    dialog.toast({
      title: t('conversation.interactionPaused'),
      message: t('conversation.interactionPausedMessage'),
      tone: 'amber',
      position: 'bottom',
      durationMs: 1600,
    })
  }, [dialog, t])

  const finishFirstSearchResultOpen = useCallback((feedbackQuery: string) => {
    pendingSearchSubmitRef.current = null
    const firstCurrentSearchMatch = filteredConversations[0]
    if (firstCurrentSearchMatch) {
      openConversation(firstCurrentSearchMatch.id)
      return
    }
    setSearchInputFocused(true)
    searchInputRef.current?.focus()
    dialog.toast({
      title: t('conversation.noSearchResults'),
      message: t('conversation.noSearchSubmitFeedback', { query: feedbackQuery }),
      tone: 'amber',
      position: 'bottom',
      durationMs: 2600,
    })
  }, [dialog, filteredConversations, openConversation, t])

  useEffect(() => {
    const pendingSubmit = pendingSearchSubmitRef.current
    if (!pendingSubmit) return
    if (!searchActive || pendingSubmit.normalized !== normalizedQuery) {
      pendingSearchSubmitRef.current = null
      return
    }
    if (searchPending || deferredNormalizedQuery !== normalizedQuery || conversationSearchIndexState.source !== conversations) return
    finishFirstSearchResultOpen(pendingSubmit.label)
  }, [conversationSearchIndexState.source, conversations, deferredNormalizedQuery, finishFirstSearchResultOpen, normalizedQuery, searchActive, searchPending])

  const openFirstSearchResult = useCallback(() => {
    if (!searchActive) {
      clearSearch()
      return
    }
    pendingSearchSubmitRef.current = { normalized: normalizedQuery, label: trimmedQuery }
    if (searchPending || deferredNormalizedQuery !== normalizedQuery || conversationSearchIndexState.source !== conversations) return
    finishFirstSearchResultOpen(trimmedQuery)
  }, [clearSearch, conversationSearchIndexState.source, conversations, deferredNormalizedQuery, finishFirstSearchResultOpen, normalizedQuery, searchActive, searchPending, trimmedQuery])

  const renderConversationRow = useCallback(
    ({ item, index }: { item: Conversation; index: number }) => {
      const searchMatch = searchActive ? searchMatchByConversationId.get(item.id) : undefined
      return (
        <ConversationRow
          conversation={item}
          index={index}
          active={item.id === currentId}
          animateEntrance={conversationEntranceAnimationEnabled && index < LIST_INITIAL_RENDER_COUNT}
          interactionDisabled={searchPending}
          isInteractionBlocked={isListInteractionBlocked}
          onInteractionBlocked={showListInteractionBlockedFeedback}
          modelLabel={modelLabelByConversationId.get(item.id)}
          onOpen={openConversation}
          onRenameFocus={keepRenameInputVisible}
          onLayoutHeight={handleConversationRowLayout}
          searchMatchSummary={searchMatch?.preview}
          searchMatchFieldLabel={searchMatch?.fieldLabel}
          searchMatchAccessibilitySummary={searchMatch?.accessibilitySummary}
          now={relativeTimeNow}
        />
      )
    },
    [conversationEntranceAnimationEnabled, currentId, handleConversationRowLayout, isListInteractionBlocked, keepRenameInputVisible, modelLabelByConversationId, openConversation, relativeTimeNow, searchActive, searchMatchByConversationId, searchPending, showListInteractionBlockedFeedback]
  )

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: pageHorizontalPadding, paddingTop: 10, paddingBottom: 14 }}>
        <IsleHeader
          title={t('conversation.title')}
          leading={
            onHome ? (
              <AnimatedNavigationTrigger variant="iconButton" label={t('common.home')} size="lg" glyph="home" onNavigate={onHome} color={colors.text} />
            ) : undefined
          }
          trailing={
            <AnimatedNavigationTrigger
              variant="iconButton"
              label={newConversationLabel}
              glyph="new-chat"
              onNavigate={createConversation}
              externalActive={creatingConversation}
              disabled={creatingConversation}
              color={colors.ui.control.primaryForeground}
              style={{
                width: primaryActionSize,
                height: primaryActionSize,
                borderRadius: colors.ui.radius.controlLarge,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.ui.control.primaryBackground,
                borderWidth: subtleBorderWidth,
                borderColor: colors.ui.control.primaryBorder,
                shadowColor: colors.ui.control.shadow,
                shadowOpacity: colors.ui.cartoon ? Math.min(colors.ui.control.primaryShadowOpacity, 0.08) : 0,
                shadowRadius: colors.ui.cartoon ? colors.ui.control.primaryShadowRadius : 0,
                shadowOffset: { width: 0, height: colors.ui.cartoon ? colors.ui.control.primaryShadowOffset : 0 },
                elevation: colors.ui.cartoon ? 1 : 0,
              }}
            />
          }
        />
        <View
          style={{
            minHeight: 50,
            borderRadius: colors.ui.radius.controlMiddle,
            paddingHorizontal: searchHorizontalPadding,
            marginTop: 16,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            backgroundColor: searchShellBackground,
            borderWidth: subtleBorderWidth,
            borderColor: searchShellBorder,
          }}
        >
          <AppIcon name="search" color={colors.textTertiary} size={18} strokeWidth={appIconStroke.fine} />
          <TextInput
            ref={searchInputRef}
            value={query}
            onChangeText={handleSearchChange}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={openFirstSearchResult}
            onFocus={handleSearchFocus}
            onBlur={handleSearchBlur}
            placeholder={t('conversation.searchConversations')}
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel={t('conversation.searchConversations')}
            accessibilityHint={t('conversation.searchConversationsAccessibilityHint')}
            accessibilityState={searchPending ? { busy: true } : undefined}
            accessibilityValue={searchInputAccessibilityValue}
            style={{ flex: 1, minWidth: 0, minHeight: 48, color: colors.text, fontSize: 15, fontWeight: '700', padding: 0 }}
          />
          {hasRawSearchInput ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              {searchPending ? (
                <View
                  accessibilityRole="progressbar"
                  accessibilityLabel={t('conversation.searchPendingForQuery', { query: trimmedQuery })}
                  style={{ width: 28, height: 44, alignItems: 'center', justifyContent: 'center' }}
                >
                  <ActivityIndicator color={colors.ui.icon.accentForeground} size="small" />
                </View>
              ) : null}
              {hasSearchInput ? (
                <IslePressable
                  haptic={!firstSearchResultActionDisabled}
                  disabled={firstSearchResultActionDisabled}
                  onPress={firstSearchResultActionDisabled ? undefined : openFirstSearchResult}
                  accessibilityRole="button"
                  accessibilityLabel={firstSearchResultActionAccessibilityLabel}
                  accessibilityHint={firstSearchResultActionAccessibilityHint}
                  accessibilityState={firstSearchResultActionDisabled ? { busy: true, disabled: true } : undefined}
                  accessibilityValue={firstSearchResultActionAccessibilityValue}
                  hitSlop={ICON_ACTION_HIT_SLOP}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: colors.ui.radius.controlMiddle,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: firstSearchResultActionHasMatch ? colors.ui.control.primaryBackground : chromeIconSurface,
                    borderWidth: subtleBorderWidth,
                    borderColor: firstSearchResultActionHasMatch ? colors.ui.control.primaryBorder : chromeIconBorder,
                    opacity: firstSearchResultActionDisabled ? 0.55 : 1,
                  }}
                >
                  <AppIcon name="arrow-right" color={firstSearchResultActionHasMatch ? colors.ui.control.primaryForeground : colors.textSecondary} size={16} strokeWidth={appIconStroke.strong} />
                </IslePressable>
              ) : null}
              <IslePressable
                onPress={clearSearch}
                accessibilityRole="button"
                accessibilityLabel={t('common.clearSearch')}
                accessibilityHint={t('common.clearSearchHint')}
                hitSlop={ICON_ACTION_HIT_SLOP}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: colors.ui.radius.controlMiddle,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: chromeIconSurface,
                  borderWidth: subtleBorderWidth,
                  borderColor: chromeIconBorder,
                }}
              >
                <AppIcon name="close" color={colors.textSecondary} size={16} />
              </IslePressable>
            </View>
          ) : null}
        </View>
        {listSummaryDisplayLabel ? (
          <Text
            accessibilityLabel={listSummaryAccessibilityLabel || undefined}
            accessibilityLiveRegion={searchActive || searchPending ? 'polite' : 'none'}
            style={{
              color: colors.textTertiary,
              fontSize: 12,
              lineHeight: 16,
              marginTop: 8,
              paddingHorizontal: 2,
              fontWeight: '800',
            }}
          >
            {listSummaryDisplayLabel}
          </Text>
        ) : null}
      </View>
      <FlashList
        ref={listRef}
        data={filteredConversations}
        extraData={conversationListExtraData}
        accessibilityRole="list"
        accessibilityLabel={t('conversation.title')}
        accessibilityState={listAccessibilityState}
        accessibilityValue={listAccessibilityValue}
        keyExtractor={(item) => item.id}
        maintainVisibleContentPosition={listMaintainVisibleContentPosition}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        onTouchStart={handleListTouchStart}
        onTouchEnd={handleListTouchEnd}
        onTouchCancel={handleListTouchEnd}
        onScroll={handleListScroll}
        onScrollBeginDrag={handleListScrollBeginDrag}
        onScrollEndDrag={handleListScrollEndDrag}
        onMomentumScrollBegin={handleListMomentumScrollBegin}
        onMomentumScrollEnd={handleListMomentumScrollEnd}
        onViewableItemsChanged={handleListViewableItemsChanged}
        viewabilityConfig={listViewabilityConfig}
        scrollEventThrottle={32}
        contentContainerStyle={{ paddingHorizontal: listHorizontalPadding, paddingBottom: listBottomPadding }}
        ListEmptyComponent={
          trimmedQuery
            ? searchPending
              ? (
                <IsleEmptyState
                  title={t('conversation.searchPendingForQuery', { query: trimmedQuery })}
                  description={t('conversation.searchPendingDescription', { query: trimmedQuery })}
                  contextual
                />
              )
              : (
                <IsleEmptyState
                  title={t('conversation.noSearchResults')}
                  description={t('conversation.noSearchResultsDescription', { query: trimmedQuery })}
                  actionLabel={t('common.clearSearch')}
                  onAction={clearSearch}
                  contextual
                />
              )
            : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }}>
                <IsleEmptyState
                  title={t('conversation.emptyHistory')}
                  actionLabel={newConversationLabel}
                  actionGlyph="new-chat"
                  actionBusy={creatingConversation}
                  actionDisabled={creatingConversation}
                  onAction={() => void createConversation()}
                  contextual
                />
              </View>
            )
        }
        ListFooterComponent={listFooter}
        renderItem={renderConversationRow}
      />
      {currentConversationActionAvailable ? (
        <View pointerEvents="box-none" style={{ position: 'absolute', right: listHorizontalPadding, bottom: scrollTopActionBottom, zIndex: 20 }}>
          <IslePressable
            haptic={!currentConversationActionLocked}
            disabled={currentConversationActionLocked}
            onPress={currentConversationActionLocked ? undefined : scrollToCurrentConversation}
            accessibilityRole="button"
            accessibilityLabel={t('conversation.scrollToCurrent')}
            accessibilityHint={currentConversationActionAccessibilityHint}
            accessibilityState={currentConversationActionAccessibilityState}
            accessibilityValue={currentConversationActionAccessibilityValue}
            hitSlop={ICON_ACTION_HIT_SLOP}
            style={{
              width: currentConversationActionWidth,
              height: SCROLL_TOP_ACTION_SIZE,
              borderRadius: colors.ui.radius.controlMiddle,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 7,
              paddingHorizontal: 12,
              backgroundColor: colors.ui.control.primaryBackground,
              borderWidth: subtleBorderWidth,
              borderColor: colors.ui.control.primaryBorder,
              shadowColor: colors.ui.control.shadow,
              shadowOpacity: colors.ui.cartoon ? Math.min(colors.ui.control.primaryShadowOpacity, 0.08) : 0,
              shadowRadius: colors.ui.cartoon ? colors.ui.control.primaryShadowRadius : 0,
              shadowOffset: { width: 0, height: colors.ui.cartoon ? colors.ui.control.primaryShadowOffset : 0 },
              elevation: colors.ui.cartoon ? 1 : 0,
              opacity: currentConversationActionLocked ? 0.64 : 1,
            }}
          >
            <AppIcon name="message" color={colors.ui.control.primaryForeground} size={17} strokeWidth={appIconStroke.strong} />
            <View style={{ flexShrink: 1, minWidth: 0, justifyContent: 'center', gap: 1 }}>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.78}
                style={{
                  color: colors.ui.control.primaryForeground,
                  fontSize: 12,
                  lineHeight: 15,
                  fontWeight: '900',
                  includeFontPadding: false,
                }}
              >
                {t('conversation.scrollToCurrent')}
              </Text>
              {currentConversationActionPositionLabel ? (
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.78}
                  style={{
                    color: colors.ui.control.primaryForeground,
                    fontSize: 10,
                    lineHeight: 12,
                    fontWeight: '900',
                    includeFontPadding: false,
                    opacity: 0.82,
                  }}
                >
                  {currentConversationActionPositionLabel}
                </Text>
              ) : null}
            </View>
          </IslePressable>
        </View>
      ) : null}
      {scrollTopActionAvailable ? (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            right: listHorizontalPadding,
            bottom: scrollTopActionBottom + (currentConversationActionAvailable ? SCROLL_TOP_ACTION_SIZE + FLOATING_HISTORY_ACTION_GAP : 0),
            zIndex: 20,
          }}
        >
          <IslePressable
            haptic={!scrollTopActionLocked}
            disabled={scrollTopActionLocked}
            onPress={scrollTopActionLocked ? undefined : scrollToTop}
            accessibilityRole="button"
            accessibilityLabel={t('common.scrollToTop')}
            accessibilityHint={scrollTopActionAccessibilityHint}
            accessibilityState={scrollTopActionAccessibilityState}
            hitSlop={ICON_ACTION_HIT_SLOP}
            style={{
              width: SCROLL_TOP_ACTION_SIZE,
              height: SCROLL_TOP_ACTION_SIZE,
              borderRadius: colors.ui.radius.controlMiddle,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: floatingSecondarySurface,
              borderWidth: subtleBorderWidth,
              borderColor: floatingSecondaryBorder,
              shadowColor: colors.shadowTint,
              shadowOpacity: floatingSecondaryShadowOpacity,
              shadowRadius: floatingSecondaryShadowRadius,
              shadowOffset: { width: 0, height: floatingSecondaryShadowOffset },
              elevation: colors.ui.cartoon && floatingSecondaryShadowOpacity > 0 ? 1 : 0,
              opacity: scrollTopActionLocked ? 0.64 : 1,
            }}
          >
            <AppIcon name="arrow-up" color={colors.textSecondary} size={17} strokeWidth={appIconStroke.bold} />
          </IslePressable>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  )
}

function buildConversationSearchIndexItem(conversation: Conversation, providerById?: ReadonlyMap<string, AIProvider>): ConversationSearchIndexItem {
  const provider = providerById?.get(conversation.providerId)
  const fields = [
    buildConversationSearchField('title', conversation.title),
    buildConversationSearchField('provider', provider?.name),
    buildConversationSearchField('provider', conversation.providerId),
    buildConversationSearchField('model', getProviderDisplayModel(provider, conversation.model)),
    buildConversationSearchField('model', conversation.model),
    buildConversationSearchField('systemPrompt', conversation.systemPrompt),
    ...buildConversationSearchMessageFields(conversation),
  ].filter((field) => field.normalized.length > 0)
  return {
    conversation,
    searchableText: fields.map((field) => field.normalized).join('\n'),
    fields,
  }
}

function getRankedConversationSearchResults(items: ConversationSearchIndexItem[], normalizedQuery: string): ConversationSearchResult[] {
  if (!normalizedQuery) return []
  return items.flatMap((item, originalIndex) => {
    if (!item.searchableText.includes(normalizedQuery)) return []
    const match = pickBestConversationSearchField(item.fields, normalizedQuery)
    if (!match) return []
    return [{
      conversation: item.conversation,
      match,
      score: scoreConversationSearchField(match, normalizedQuery),
      recency: getConversationSearchRecency(item.conversation),
      originalIndex,
    }]
  }).sort(compareConversationSearchResults)
}

function pickBestConversationSearchField(fields: ConversationSearchField[], normalizedQuery: string): ConversationSearchField | undefined {
  let bestMatch: ConversationSearchField | undefined
  let bestScore = Number.NEGATIVE_INFINITY
  for (const field of fields) {
    if (!field.normalized.includes(normalizedQuery)) continue
    const score = scoreConversationSearchField(field, normalizedQuery)
    if (score <= bestScore) continue
    bestMatch = field
    bestScore = score
  }
  return bestMatch
}

function scoreConversationSearchField(field: ConversationSearchField, normalizedQuery: string): number {
  const matchIndex = field.normalized.indexOf(normalizedQuery)
  if (matchIndex < 0) return Number.NEGATIVE_INFINITY
  const exactBoost = field.normalized === normalizedQuery ? 240 : 0
  const prefixBoost = field.normalized.startsWith(normalizedQuery) ? 120 : 0
  const positionBoost = Math.max(0, 90 - Math.min(matchIndex, 90))
  return SEARCH_FIELD_MATCH_WEIGHT[field.key] + exactBoost + prefixBoost + positionBoost
}

function compareConversationSearchResults(a: ConversationSearchResult, b: ConversationSearchResult): number {
  if (a.score !== b.score) return b.score - a.score
  if (a.recency !== b.recency) return b.recency - a.recency
  return a.originalIndex - b.originalIndex
}

function getConversationSearchRecency(conversation: Conversation): number {
  return conversation.updatedAt || conversation.messages.at(-1)?.timestamp || conversation.createdAt || 0
}

function buildConversationSearchMessageFields(conversation: Conversation): ConversationSearchField[] {
  const fields: ConversationSearchField[] = []
  const seen = new Set<string>()
  let indexedLength = 0

  const addMessageField = (message: Conversation['messages'][number], force = false) => {
    if (seen.has(message.id)) return
    if (!force && indexedLength >= SEARCH_MESSAGE_INDEX_BUDGET) return
    const field = buildConversationMessageSearchField(message.responseText ?? message.content)
    if (!field.normalized) {
      seen.add(message.id)
      return
    }
    fields.push(field)
    seen.add(message.id)
    indexedLength += field.indexedValue.length
  }

  for (const message of conversation.messages.slice(0, SEARCH_FIRST_MESSAGE_LIMIT)) {
    addMessageField(message, true)
  }
  for (const message of conversation.messages.slice(-SEARCH_RECENT_MESSAGE_LIMIT)) {
    addMessageField(message, true)
  }
  for (let index = conversation.messages.length - SEARCH_RECENT_MESSAGE_LIMIT - 1; index >= SEARCH_FIRST_MESSAGE_LIMIT; index -= 1) {
    if (indexedLength >= SEARCH_MESSAGE_INDEX_BUDGET) break
    const message = conversation.messages[index]
    if (message) addMessageField(message)
  }

  return fields
}

function buildConversationSearchField(key: ConversationSearchFieldKey, value?: string, indexLimit = SEARCH_FIELD_INDEX_LIMIT): ConversationSearchField {
  const indexedValue = compactSearchField(value, indexLimit)
  return {
    key,
    value: compactSearchField(value, SEARCH_FIELD_PREVIEW_LIMIT),
    indexedValue,
    normalized: normalizeSearchText(indexedValue),
  }
}

function buildConversationMessageSearchField(value?: string): ConversationSearchField {
  const indexedValue = compactMessageSearchField(value, SEARCH_MESSAGE_FIELD_INDEX_LIMIT)
  return {
    key: 'message',
    value: compactMessageSearchField(value, SEARCH_FIELD_PREVIEW_LIMIT),
    indexedValue,
    normalized: normalizeSearchText(indexedValue),
  }
}

function conversationSearchFieldLabelKey(key: ConversationSearchFieldKey): string {
  switch (key) {
    case 'title':
      return 'conversation.searchMatchTitle'
    case 'provider':
      return 'conversation.searchMatchProvider'
    case 'model':
      return 'conversation.searchMatchModel'
    case 'systemPrompt':
      return 'conversation.searchMatchSystemPrompt'
    case 'message':
      return 'conversation.searchMatchMessage'
  }
}

function summarizeConversationSearchMatch(field: ConversationSearchField, normalizedQuery: string): string {
  const query = normalizedQuery.trim()
  if (!query) return field.value
  const lowerSource = field.indexedValue.toLowerCase()
  const matchIndex = lowerSource.indexOf(query)
  const fallbackMatchIndex = field.normalized.indexOf(query)
  const contextIndex = matchIndex >= 0 ? matchIndex : fallbackMatchIndex
  if (contextIndex < 0) return field.value
  const start = Math.max(0, contextIndex - SEARCH_MATCH_CONTEXT_RADIUS)
  const end = Math.min(field.indexedValue.length, contextIndex + query.length + SEARCH_MATCH_CONTEXT_RADIUS)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < field.indexedValue.length ? '...' : ''
  return `${prefix}${field.indexedValue.slice(start, end).trim()}${suffix}`
}

function compactSearchField(value: string | undefined, limit: number): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit)
}

function compactMessageSearchField(value: string | undefined, limit: number): string {
  const source = value ?? ''
  const scanLimit = Math.max(limit + ' ... '.length, limit * SEARCH_MESSAGE_FIELD_SCAN_MULTIPLIER)
  const compact = source.length > scanLimit
    ? compactLongMessageSearchField(source, limit, scanLimit)
    : source.replace(/\s+/g, ' ').trim()
  if (compact.length <= limit) return compact
  const separator = ' ... '
  const headLength = Math.max(0, Math.floor(limit * 0.62))
  const tailLength = Math.max(0, limit - headLength - separator.length)
  return `${compact.slice(0, headLength).trimEnd()}${separator}${compact.slice(compact.length - tailLength).trimStart()}`
}

function compactLongMessageSearchField(value: string, limit: number, scanLimit: number): string {
  const separator = ' ... '
  const sampleBudget = Math.max(limit + separator.length, scanLimit)
  const headSampleLength = Math.max(0, Math.floor(sampleBudget * 0.62))
  const tailSampleLength = Math.max(0, sampleBudget - headSampleLength - separator.length)
  const head = value.slice(0, headSampleLength).replace(/\s+/g, ' ').trim()
  const tail = value.slice(value.length - tailSampleLength).replace(/\s+/g, ' ').trim()
  if (!head) return tail
  if (!tail) return head
  return `${head}${separator}${tail}`.trim()
}
