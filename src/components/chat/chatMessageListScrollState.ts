import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react'
import { Keyboard, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import type { FlashListRef, ViewToken } from '@shopify/flash-list'

import type { Message } from '@/types/chatContracts'

import {
  AUTO_SCROLL_DELAY_MS,
  CONVERSATION_NAVIGATION_IDLE_HIDE_DELAY_MS,
  CONVERSATION_NAVIGATION_INTERACTION_HIDE_DELAY_MS,
  CONVERSATION_NAVIGATION_PROGRAMMATIC_LOCK_MS,
  MESSAGE_LIST_MOMENTUM_ELIGIBILITY_MS,
  MESSAGE_LIST_TOUCH_PAGER_GESTURE_RELEASE_DELAY_MS,
  USER_SCROLL_PAUSE_THRESHOLD,
} from './chatWorkspaceConstants'
import {
  buildAssistantNavigationItems,
  buildMessageScrollViewport,
  createEmptyMessageScrollViewport,
  shouldReplaceMessageScrollViewport,
  type AssistantNavigationItem,
  type AssistantNavigationScrollOptions,
  type MessageScrollViewport,
} from './messageListNavigation'

export function useChatMessageListScrollController({
  activeActionMessageId,
  autoStickToBottom,
  chromeCollapsed,
  collapseChrome,
  conversationId,
  lastScrollOffset,
  listRef,
  messageListBottomPadding,
  messageListTopInset,
  messages,
  onCloseOverlays,
  pagerGesturePersistentlyLocked,
  setActiveActionMessageId,
  setPagerGestureLocked,
}: {
  activeActionMessageId: string | null
  autoStickToBottom: MutableRefObject<boolean>
  chromeCollapsed: boolean
  collapseChrome: () => void
  conversationId: string
  lastScrollOffset: MutableRefObject<number>
  listRef: RefObject<FlashListRef<Message> | null>
  messageListBottomPadding: number
  messageListTopInset: number
  messages: Message[]
  onCloseOverlays: () => void
  pagerGesturePersistentlyLocked: boolean
  setActiveActionMessageId: Dispatch<SetStateAction<string | null>>
  setPagerGestureLocked?: (locked: boolean) => void
}) {
  const [messageScrollViewport, setMessageScrollViewport] = useState<MessageScrollViewport>(() => createEmptyMessageScrollViewport())
  const messageScrollViewportRef = useRef<MessageScrollViewport>(messageScrollViewport)
  const [unreadMessageCount, setUnreadMessageCount] = useState(0)
  const observedMessageIdsRef = useRef<Set<string>>(new Set(messages.map((message) => message.id)))
  const userScrollInteractionActive = useRef(false)
  const assistantNavigationItems = useMemo(() => buildAssistantNavigationItems(messages), [messages])
  const assistantNavigationVisible = assistantNavigationItems.length > 1
  const assistantNavigationSignature = assistantNavigationItems.map((item) => item.messageId).join('|')
  const messageIdentitySignature = messages.map((message) => message.id).join('|')
  const latestAssistantNavigationId = assistantNavigationItems.at(-1)?.messageId ?? null
  const [activeAssistantNavigationId, setActiveAssistantNavigationId] = useState<string | null>(latestAssistantNavigationId)
  const [assistantNavigationFloatingVisible, setAssistantNavigationFloatingVisible] = useState(false)
  const activeAssistantNavigationItem = assistantNavigationItems.find((item) => item.messageId === activeAssistantNavigationId) ?? assistantNavigationItems.at(-1)
  const activeAssistantNavigationIndex = activeAssistantNavigationItem
    ? assistantNavigationItems.findIndex((item) => item.messageId === activeAssistantNavigationItem.messageId)
    : -1
  const messageListMaintainVisibleContentPosition = useMemo(
    () => ({
      disabled: true,
    }),
    []
  )
  const messageListViewabilityConfig = useMemo(() => ({ viewAreaCoveragePercentThreshold: 18, minimumViewTime: 80 }), [])
  const assistantNavigationHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const assistantNavigationGestureActive = useRef(false)
  const assistantNavigationProgrammaticLockUntil = useRef(0)
  const layoutScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestMessageScrollTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  const userDragMomentumEligible = useRef(false)
  const userDragMomentumEligibilityTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pagerGestureScrollReleaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persistentPagerGestureLockRef = useRef(false)
  const lastLayoutScrollAt = useRef(0)

  const clearLatestMessageScrollTimers = useCallback(() => {
    for (const timer of latestMessageScrollTimers.current) clearTimeout(timer)
    latestMessageScrollTimers.current.clear()
  }, [])

  const clearLayoutScrollTimer = useCallback(() => {
    if (!layoutScrollTimer.current) return
    clearTimeout(layoutScrollTimer.current)
    layoutScrollTimer.current = null
  }, [])

  const clearAssistantNavigationHideTimer = useCallback(() => {
    if (!assistantNavigationHideTimer.current) return
    clearTimeout(assistantNavigationHideTimer.current)
    assistantNavigationHideTimer.current = null
  }, [])

  const revealAssistantNavigation = useCallback((delayMs = CONVERSATION_NAVIGATION_IDLE_HIDE_DELAY_MS) => {
    if (!assistantNavigationVisible) return
    clearAssistantNavigationHideTimer()
    setAssistantNavigationFloatingVisible(true)
    assistantNavigationHideTimer.current = setTimeout(() => {
      setAssistantNavigationFloatingVisible(false)
      assistantNavigationHideTimer.current = null
    }, delayMs)
  }, [assistantNavigationVisible, clearAssistantNavigationHideTimer])

  const shouldAutoFollowLatestMessage = useCallback(() => {
    const viewport = messageScrollViewportRef.current
    return autoStickToBottom.current &&
      !userScrollInteractionActive.current &&
      !userDragMomentumEligible.current &&
      (!viewport.viewportHeight || !viewport.awayFromBottom)
  }, [autoStickToBottom])

  useEffect(() => {
    messageScrollViewportRef.current = messageScrollViewport
  }, [messageScrollViewport])

  useEffect(() => {
    const observed = observedMessageIdsRef.current
    const nextObserved = new Set(messages.map((message) => message.id))
    const appendedCount = messages.reduce((count, message) => count + (observed.has(message.id) ? 0 : 1), 0)
    observedMessageIdsRef.current = nextObserved
    if (!messageScrollViewportRef.current.awayFromBottom) {
      setUnreadMessageCount(0)
      return
    }
    if (appendedCount > 0) setUnreadMessageCount((current) => current + appendedCount)
  }, [conversationId, messageIdentitySignature])

  useEffect(() => () => clearAssistantNavigationHideTimer(), [clearAssistantNavigationHideTimer])

  useEffect(() => {
    if (assistantNavigationVisible) return
    clearAssistantNavigationHideTimer()
    setAssistantNavigationFloatingVisible(false)
  }, [assistantNavigationVisible, clearAssistantNavigationHideTimer])

  useEffect(() => {
    setActiveAssistantNavigationId((current) => {
      if (autoStickToBottom.current && latestAssistantNavigationId) return latestAssistantNavigationId
      if (current && assistantNavigationItems.some((item) => item.messageId === current)) return current
      return latestAssistantNavigationId
    })
  }, [assistantNavigationItems, assistantNavigationSignature, autoStickToBottom, conversationId, latestAssistantNavigationId])

  useEffect(() => {
    persistentPagerGestureLockRef.current = pagerGesturePersistentlyLocked
  }, [pagerGesturePersistentlyLocked])

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

  const commitMessageScrollViewport = useCallback((nextViewport: MessageScrollViewport) => {
    messageScrollViewportRef.current = nextViewport
    setMessageScrollViewport((current) => {
      if (!shouldReplaceMessageScrollViewport(current, nextViewport)) return current
      return nextViewport
    })
  }, [])

  const clearPendingMessageScrolls = useCallback(() => {
    clearLatestMessageScrollTimers()
    clearLayoutScrollTimer()
  }, [clearLatestMessageScrollTimers, clearLayoutScrollTimer])

  useEffect(() => {
    setActiveActionMessageId(null)
    const emptyViewport = createEmptyMessageScrollViewport()
    messageScrollViewportRef.current = emptyViewport
    setMessageScrollViewport(emptyViewport)
    setUnreadMessageCount(0)
    observedMessageIdsRef.current = new Set(messages.map((message) => message.id))
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
  }, [autoStickToBottom, clearPagerGestureScrollReleaseTimer, clearPendingMessageScrolls, conversationId, lastScrollOffset, setActiveActionMessageId, setPagerGestureLocked])

  useEffect(() => {
    return () => {
      clearPendingMessageScrolls()
      if (userDragMomentumEligibilityTimer.current) clearTimeout(userDragMomentumEligibilityTimer.current)
      clearPagerGestureScrollReleaseTimer()
      if (!persistentPagerGestureLockRef.current) setPagerGestureLocked?.(false)
    }
  }, [clearPendingMessageScrolls, clearPagerGestureScrollReleaseTimer, setPagerGestureLocked])

  const requestMessageLayoutScroll = useCallback((options?: { force?: boolean }) => {
    const force = options?.force === true
    if (force) autoStickToBottom.current = true
    if (!force && !shouldAutoFollowLatestMessage()) return
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
      if (!force && !shouldAutoFollowLatestMessage()) return
      lastLayoutScrollAt.current = Date.now()
      listRef.current?.scrollToEnd({ animated: false })
    }, wait)
  }, [autoStickToBottom, clearLayoutScrollTimer, listRef, shouldAutoFollowLatestMessage])

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

  const scrollToMessageListBottom = useCallback(() => {
    setUnreadMessageCount(0)
    onCloseOverlays()
    scrollToLatestMessage(true, 0, { force: true, replacePending: true })
  }, [onCloseOverlays, scrollToLatestMessage])

  const handleListScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (activeActionMessageId) setActiveActionMessageId(null)
    const y = event.nativeEvent.contentOffset.y
    const delta = y - lastScrollOffset.current
    const viewportHeight = event.nativeEvent.layoutMeasurement.height
    const contentHeight = event.nativeEvent.contentSize.height
    const nextViewport = buildMessageScrollViewport(contentHeight, viewportHeight, y, USER_SCROLL_PAUSE_THRESHOLD)
    commitMessageScrollViewport(nextViewport)
    if (!nextViewport.awayFromBottom) {
      autoStickToBottom.current = true
      setUnreadMessageCount(0)
      if (
        assistantNavigationVisible &&
        latestAssistantNavigationId &&
        !assistantNavigationGestureActive.current &&
        Date.now() >= assistantNavigationProgrammaticLockUntil.current
      ) {
        setActiveAssistantNavigationId(latestAssistantNavigationId)
      }
    } else if (userScrollInteractionActive.current || Math.abs(delta) > 4) {
      autoStickToBottom.current = false
    }
    const userDrivenScroll = userScrollInteractionActive.current || userDragMomentumEligible.current
    if (assistantNavigationVisible && userDrivenScroll) {
      revealAssistantNavigation()
    }
    if (userDrivenScroll && delta > 8 && !chromeCollapsed) collapseChrome()
    lastScrollOffset.current = y
  }, [activeActionMessageId, assistantNavigationVisible, autoStickToBottom, chromeCollapsed, collapseChrome, commitMessageScrollViewport, lastScrollOffset, latestAssistantNavigationId, revealAssistantNavigation, setActiveActionMessageId])

  const handleListTouchStart = useCallback(() => {
    Keyboard.dismiss()
    lockPagerGestureForMessageScroll()
  }, [lockPagerGestureForMessageScroll])

  const handleListTouchEnd = useCallback(() => {
    if (userScrollInteractionActive.current || userDragMomentumEligible.current) return
    releasePagerGestureAfterMessageScroll(MESSAGE_LIST_TOUCH_PAGER_GESTURE_RELEASE_DELAY_MS)
  }, [releasePagerGestureAfterMessageScroll])

  const handleListScrollBeginDrag = useCallback(() => {
    lockPagerGestureForMessageScroll()
    assistantNavigationProgrammaticLockUntil.current = 0
    revealAssistantNavigation()
    if (userDragMomentumEligibilityTimer.current) {
      clearTimeout(userDragMomentumEligibilityTimer.current)
      userDragMomentumEligibilityTimer.current = null
    }
    userScrollInteractionActive.current = true
    userDragMomentumEligible.current = true
    autoStickToBottom.current = false
    clearPendingMessageScrolls()
  }, [autoStickToBottom, clearPendingMessageScrolls, lockPagerGestureForMessageScroll, revealAssistantNavigation])

  const restoreAutoStickIfNearBottom = useCallback(() => {
    if (!messageScrollViewportRef.current.awayFromBottom) autoStickToBottom.current = true
  }, [autoStickToBottom])

  const handleListScrollEndDrag = useCallback(() => {
    userScrollInteractionActive.current = false
    restoreAutoStickIfNearBottom()
    if (userDragMomentumEligibilityTimer.current) clearTimeout(userDragMomentumEligibilityTimer.current)
    userDragMomentumEligibilityTimer.current = setTimeout(() => {
      userDragMomentumEligible.current = false
      userDragMomentumEligibilityTimer.current = null
    }, MESSAGE_LIST_MOMENTUM_ELIGIBILITY_MS)
    releasePagerGestureAfterMessageScroll(MESSAGE_LIST_MOMENTUM_ELIGIBILITY_MS + 40)
  }, [releasePagerGestureAfterMessageScroll, restoreAutoStickIfNearBottom])

  const handleListMomentumScrollBegin = useCallback(() => {
    if (!userDragMomentumEligible.current) return
    lockPagerGestureForMessageScroll()
    revealAssistantNavigation()
    if (userDragMomentumEligibilityTimer.current) {
      clearTimeout(userDragMomentumEligibilityTimer.current)
      userDragMomentumEligibilityTimer.current = null
    }
    userScrollInteractionActive.current = true
    autoStickToBottom.current = false
    clearPendingMessageScrolls()
  }, [autoStickToBottom, clearPendingMessageScrolls, lockPagerGestureForMessageScroll, revealAssistantNavigation])

  const handleListMomentumScrollEnd = useCallback(() => {
    userScrollInteractionActive.current = false
    userDragMomentumEligible.current = false
    if (userDragMomentumEligibilityTimer.current) {
      clearTimeout(userDragMomentumEligibilityTimer.current)
      userDragMomentumEligibilityTimer.current = null
    }
    restoreAutoStickIfNearBottom()
    releasePagerGestureAfterMessageScroll()
  }, [releasePagerGestureAfterMessageScroll, restoreAutoStickIfNearBottom])

  const handleListLayout = useCallback((event: LayoutChangeEvent) => {
    const viewportHeight = Math.ceil(event.nativeEvent.layout.height)
    const currentViewport = messageScrollViewportRef.current
    commitMessageScrollViewport(buildMessageScrollViewport(currentViewport.contentHeight, viewportHeight, currentViewport.scrollY, USER_SCROLL_PAUSE_THRESHOLD))
    if (shouldAutoFollowLatestMessage()) requestMessageLayoutScroll()
  }, [commitMessageScrollViewport, requestMessageLayoutScroll, shouldAutoFollowLatestMessage])

  const handleListContentSizeChange = useCallback((_width: number, contentHeight: number) => {
    const measuredContentHeight = Math.ceil(contentHeight)
    const currentViewport = messageScrollViewportRef.current
    commitMessageScrollViewport(buildMessageScrollViewport(measuredContentHeight, currentViewport.viewportHeight, currentViewport.scrollY, USER_SCROLL_PAUSE_THRESHOLD))
    if (shouldAutoFollowLatestMessage()) requestMessageLayoutScroll()
  }, [commitMessageScrollViewport, requestMessageLayoutScroll, shouldAutoFollowLatestMessage])

  const handleMessageViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<Message>[] }) => {
    if (assistantNavigationGestureActive.current || Date.now() < assistantNavigationProgrammaticLockUntil.current) return
    const firstAssistant = viewableItems
      .filter((token) => token.isViewable && token.item?.role === 'assistant' && typeof token.index === 'number')
      .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))[0]
    if (firstAssistant?.item?.id) setActiveAssistantNavigationId(firstAssistant.item.id)
  }, [])

  const scrollToAssistantNavigationItem = useCallback((item: AssistantNavigationItem, options?: AssistantNavigationScrollOptions) => {
    const animated = options?.animated ?? true
    const settle = options?.settle === true
    autoStickToBottom.current = false
    setActiveAssistantNavigationId(item.messageId)
    assistantNavigationProgrammaticLockUntil.current = Date.now() + (animated ? 520 : CONVERSATION_NAVIGATION_PROGRAMMATIC_LOCK_MS)
    revealAssistantNavigation(settle ? CONVERSATION_NAVIGATION_INTERACTION_HIDE_DELAY_MS : CONVERSATION_NAVIGATION_IDLE_HIDE_DELAY_MS)
    onCloseOverlays()
    const scrollParams = {
      index: item.messageIndex,
      animated,
      viewPosition: 0,
      viewOffset: Math.max(8, messageListTopInset),
    }
    const scrollRequest = listRef.current?.scrollToIndex(scrollParams)
    void scrollRequest?.catch(() => {
      setTimeout(() => {
        assistantNavigationProgrammaticLockUntil.current = Date.now() + CONVERSATION_NAVIGATION_PROGRAMMATIC_LOCK_MS
        const retryRequest = listRef.current?.scrollToIndex({ ...scrollParams, animated: false })
        void retryRequest?.catch(() => undefined)
      }, 80)
    })
  }, [autoStickToBottom, listRef, messageListTopInset, onCloseOverlays, revealAssistantNavigation])

  const handleAssistantNavigationInteractionStart = useCallback(() => {
    assistantNavigationGestureActive.current = true
    revealAssistantNavigation(CONVERSATION_NAVIGATION_INTERACTION_HIDE_DELAY_MS)
  }, [revealAssistantNavigation])

  const handleAssistantNavigationInteractionEnd = useCallback(() => {
    assistantNavigationGestureActive.current = false
    assistantNavigationProgrammaticLockUntil.current = Date.now() + CONVERSATION_NAVIGATION_PROGRAMMATIC_LOCK_MS
    revealAssistantNavigation(CONVERSATION_NAVIGATION_INTERACTION_HIDE_DELAY_MS)
  }, [revealAssistantNavigation])

  useEffect(() => {
    requestMessageLayoutScroll()
  }, [messageListBottomPadding, requestMessageLayoutScroll])

  useEffect(() => {
    scrollToLatestMessage(false, 120, { force: true, replacePending: true })
    scrollToLatestMessage(false, 360, { force: true })
  }, [conversationId, scrollToLatestMessage])

  return {
    activeAssistantNavigationIndex,
    activeAssistantNavigationItem,
    assistantNavigationFloatingVisible,
    assistantNavigationItems,
    assistantNavigationVisible,
    handleAssistantNavigationInteractionEnd,
    handleAssistantNavigationInteractionStart,
    handleListContentSizeChange,
    handleListLayout,
    handleListMomentumScrollBegin,
    handleListMomentumScrollEnd,
    handleListScroll,
    handleListScrollBeginDrag,
    handleListScrollEndDrag,
    handleListTouchEnd,
    handleListTouchStart,
    handleMessageViewableItemsChanged,
    messageListAwayFromBottom: messageScrollViewport.awayFromBottom,
    messageListMaintainVisibleContentPosition,
    messageListViewabilityConfig,
    requestMessageLayoutScroll,
    scrollToAssistantNavigationItem,
    scrollToMessageListBottom,
    scrollToLatestMessage,
    unreadMessageCount,
  }
}
