import { useEffect, useMemo, useRef, useState } from 'react'
import type { TFunction } from 'i18next'

import type { ChatWorkspacePrivateMemoryConfirmation } from '@/modules/workspaces'
import {
  approveChatWorkspacePendingWriteback,
  cancelChatWorkspaceReviewOperation,
  clearChatWorkspacePrivateMemory,
  dismissChatWorkspacePendingWriteback,
  loadChatWorkspaceReview,
  type ChatWorkspaceReviewViewState,
} from '@/presentation/features/conversations/chatWorkspaceReviewCommand'
import type { ChatWorkspaceReviewControllerOutcome } from '@/presentation/features/conversations/chatWorkspaceReviewController'

import type {
  ChatWorkspaceReviewBusyAction,
  ChatWorkspaceReviewConfirmationRequest,
  ChatWorkspaceReviewLabels,
  ChatWorkspaceReviewSheetProps,
} from './ChatWorkspaceReviewSheet'
import type {
  ChatWorkspaceReviewKind,
  ChatWorkspaceReviewStatus,
} from './chatWorkspaceReviewPresentation'

interface PendingConfirmation {
  readonly request: ChatWorkspaceReviewConfirmationRequest
  readonly token?: ChatWorkspacePrivateMemoryConfirmation
}

export function useChatWorkspaceReviewState({
  conversationId,
  t,
}: {
  conversationId?: string
  t: TFunction
}): {
  openReview: () => void
  sheetProps: ChatWorkspaceReviewSheetProps
} {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busyAction, setBusyAction] = useState<ChatWorkspaceReviewBusyAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<ChatWorkspaceReviewViewState | null>(null)
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null)
  const operationSequence = useRef(0)
  const labels = useMemo(() => buildLabels(t), [t])

  useEffect(() => {
    operationSequence.current += 1
    cancelChatWorkspaceReviewOperation()
    setOpen(false)
    setLoading(false)
    setBusyAction(null)
    setError(null)
    setState(null)
    setPendingConfirmation(null)
  }, [conversationId])

  useEffect(() => () => {
    operationSequence.current += 1
    cancelChatWorkspaceReviewOperation()
  }, [])

  function openReview() {
    if (!conversationId) return
    setOpen(true)
    setPendingConfirmation(null)
    void refresh(true)
  }

  function closeReview() {
    operationSequence.current += 1
    cancelChatWorkspaceReviewOperation()
    setOpen(false)
    setLoading(false)
    setBusyAction(null)
    setPendingConfirmation(null)
  }

  async function refresh(initial = false) {
    if (!conversationId) {
      setError(t('chat.workspaceReviewErrorUnavailable'))
      return
    }
    const sequence = ++operationSequence.current
    setError(null)
    setPendingConfirmation(null)
    if (initial || !state) setLoading(true)
    else setBusyAction({ kind: 'refresh' })
    const outcome = await loadChatWorkspaceReview(conversationId)
    if (operationSequence.current !== sequence) return
    if (outcome.status === 'ready') {
      setState(outcome.state)
    } else if (outcome.status === 'failed') {
      setError(t('chat.workspaceReviewErrorUnavailable'))
    }
    setLoading(false)
    setBusyAction(null)
  }

  async function requestConfirmation(request: ChatWorkspaceReviewConfirmationRequest) {
    if (request.kind === 'dismiss-writeback') {
      setPendingConfirmation({ request })
      return
    }
    if (!state) return
    const sequence = ++operationSequence.current
    setError(null)
    setBusyAction(request)
    const outcome = request.kind === 'approve-writeback'
      ? await approveChatWorkspacePendingWriteback(state, request.writebackId)
      : await clearChatWorkspacePrivateMemory(state)
    if (operationSequence.current !== sequence) return
    applyMutationOutcome(outcome, request)
    setBusyAction(null)
  }

  async function approve(writebackId: string) {
    if (!state) return
    const request = { kind: 'approve-writeback' as const, writebackId }
    const token = pendingConfirmation?.request.kind === request.kind
      && pendingConfirmation.request.writebackId === writebackId
      ? pendingConfirmation.token
      : undefined
    await mutate(request, () => approveChatWorkspacePendingWriteback(state, writebackId, token))
  }

  async function dismiss(writebackId: string) {
    if (!state) return
    const request = { kind: 'dismiss-writeback' as const, writebackId }
    await mutate(request, () => dismissChatWorkspacePendingWriteback(state, writebackId))
  }

  async function clearPrivateMemory() {
    if (!state) return
    const request = { kind: 'clear-private-memory' as const }
    const token = pendingConfirmation?.request.kind === request.kind
      ? pendingConfirmation.token
      : undefined
    await mutate(request, () => clearChatWorkspacePrivateMemory(state, token))
  }

  async function mutate(
    request: ChatWorkspaceReviewConfirmationRequest,
    operation: () => Promise<ChatWorkspaceReviewControllerOutcome>,
  ) {
    const sequence = ++operationSequence.current
    setError(null)
    setBusyAction(request)
    const outcome = await operation()
    if (operationSequence.current !== sequence) return
    applyMutationOutcome(outcome, request)
    setBusyAction(null)
  }

  function applyMutationOutcome(
    outcome: ChatWorkspaceReviewControllerOutcome,
    request: ChatWorkspaceReviewConfirmationRequest,
  ) {
    if (outcome.status === 'updated') {
      setState(outcome.state)
      setPendingConfirmation(null)
      return
    }
    if (outcome.status === 'confirmation_required') {
      setState(outcome.state)
      setPendingConfirmation({ request, token: outcome.confirmation })
      return
    }
    if (outcome.status === 'stale') {
      if (outcome.state) setState(outcome.state)
      setPendingConfirmation(null)
      setError(t('chat.workspaceReviewErrorStale'))
      return
    }
    if (outcome.status === 'not_found') {
      setState(outcome.state)
      setPendingConfirmation(null)
      setError(t('chat.workspaceReviewErrorNotFound'))
      return
    }
    if (outcome.status === 'failed') {
      setPendingConfirmation(null)
      setError(t('chat.workspaceReviewErrorUnavailable'))
    }
  }

  return {
    openReview,
    sheetProps: {
      open: open && (!state || state.conversationId === conversationId),
      loading,
      busyAction,
      error,
      projection: state?.projection ?? null,
      confirmation: pendingConfirmation?.request ?? null,
      labels,
      onApprove: approve,
      onDismiss: dismiss,
      onClearPrivateMemory: clearPrivateMemory,
      onRefresh: refresh,
      onClose: closeReview,
      onRequestConfirmation: requestConfirmation,
      onCancelConfirmation() {
        setPendingConfirmation(null)
      },
    },
  }
}

function buildLabels(t: TFunction): ChatWorkspaceReviewLabels {
  const statusLabels: Readonly<Record<ChatWorkspaceReviewStatus, string>> = {
    pending: t('chat.workspaceReviewStatusPending'),
    'needs-attention': t('chat.workspaceReviewStatusAttention'),
    conflict: t('chat.workspaceReviewStatusConflict'),
    blocked: t('chat.workspaceReviewStatusBlocked'),
  }
  const kindLabels: Readonly<Record<ChatWorkspaceReviewKind, string>> = {
    summary: t('chat.workspaceReviewKindSummary'),
    character: t('chat.workspaceReviewKindCharacter'),
    lorebook: t('chat.workspaceReviewKindLorebook'),
    memory: t('chat.workspaceReviewKindMemory'),
    scene: t('chat.workspaceReviewKindScene'),
    shaping: t('chat.workspaceReviewKindShaping'),
  }
  return {
    title: t('chat.workspaceReviewTitle'),
    subtitle: t('chat.workspaceReviewSubtitle'),
    close: t('dialog.close'),
    closeHint: t('chat.workspaceReviewCloseHint'),
    refresh: t('common.refresh'),
    refreshHint: t('chat.workspaceReviewRefreshHint'),
    loading: t('common.loading'),
    errorTitle: t('chat.workspaceReviewErrorTitle'),
    pendingListTitle: t('chat.workspaceReviewPendingListTitle'),
    emptyState: t('chat.workspaceReviewEmpty'),
    privateMemoryTitle: t('chat.workspaceReviewPrivateTitle'),
    approve: t('chat.workspaceReviewApprove'),
    dismiss: t('chat.workspaceReviewDismiss'),
    confirm: t('common.confirm'),
    cancel: t('common.cancel'),
    confirmHint: t('chat.workspaceReviewConfirmHint'),
    cancelHint: t('chat.workspaceReviewCancelHint'),
    clearPrivateMemory: t('chat.workspaceReviewClearPrivate'),
    clearPrivateMemoryHint: t('chat.workspaceReviewClearPrivateHint'),
    formatPendingWritebackCount: (count) => t('chat.workspaceReviewPendingCount', { count }),
    formatReviewUnitCount: (count) => t('chat.workspaceReviewUnitCount', { count }),
    formatPrivateMemoryCount: (count) => t('chat.workspaceReviewPrivateCount', { count }),
    formatHiddenWritebackCount: (count) => t('chat.workspaceReviewHiddenCount', { count }),
    formatWritebackPosition: (position, total) => t('chat.workspaceReviewPosition', { position, total }),
    formatWritebackAccessibilityLabel: ({ position, total, status, reviewUnitCount, kindCounts }) => t(
      'chat.workspaceReviewItemAccessibility',
      {
        position,
        total,
        status: statusLabels[status],
        units: t('chat.workspaceReviewUnitCount', { count: reviewUnitCount }),
        kinds: kindCounts.length > 0
          ? kindCounts.map(({ kind, count }) => t('chat.workspaceReviewKindCount', { kind: kindLabels[kind], count })).join(', ')
          : t('chat.workspaceReviewUnitCount', { count: reviewUnitCount }),
      },
    ),
    formatApproveHint: (position) => t('chat.workspaceReviewApproveHint', { position }),
    formatDismissHint: (position) => t('chat.workspaceReviewDismissHint', { position }),
    formatKindCount: (kind, count) => t('chat.workspaceReviewKindCount', { kind: kindLabels[kind], count }),
    formatPrivateMemoryDescription: (count) => t('chat.workspaceReviewPrivateDescription', { count }),
    formatConfirmationTitle: (request) => t(request.kind === 'approve-writeback'
      ? 'chat.workspaceReviewApproveConfirmTitle'
      : request.kind === 'dismiss-writeback'
        ? 'chat.workspaceReviewDismissConfirmTitle'
        : 'chat.workspaceReviewClearConfirmTitle'),
    formatConfirmationDescription: (request) => t(request.kind === 'approve-writeback'
      ? 'chat.workspaceReviewApproveConfirmDescription'
      : request.kind === 'dismiss-writeback'
        ? 'chat.workspaceReviewDismissConfirmDescription'
        : 'chat.workspaceReviewClearConfirmDescription'),
    statusLabels,
  }
}
