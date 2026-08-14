import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Attachment } from '@/types/chatContracts'
import type { RuntimeRepairIntent } from './RuntimeRepairIntentCard'
import { emitRuntimeRepairReplayEvent } from './runtimeRepairReplayEvents'

interface RuntimeRepairIntentActionsInput {
  conversationId: string
  runtimeRepairIntent?: RuntimeRepairIntent
  submitDependency?: string | number
  closeOverlays: () => void
  onApplyStarter: (draft: string, attachments?: Attachment[], restoreIfEmpty?: boolean) => void
}

export interface RuntimeRepairIntentActions {
  runtimeRepairSubmitKey?: string | number
  visibleRuntimeRepairIntent?: RuntimeRepairIntent
  sendRuntimeRepairIntent: () => void
  applyRuntimeRepairIntentDraft: () => void
  dismissRuntimeRepairIntent: () => void
}

export function useRuntimeRepairIntentActions({
  conversationId,
  runtimeRepairIntent,
  submitDependency,
  closeOverlays,
  onApplyStarter,
}: RuntimeRepairIntentActionsInput): RuntimeRepairIntentActions {
  const [runtimeRepairSubmitKey, setRuntimeRepairSubmitKey] = useState<string | number | undefined>(undefined)
  const [pendingRuntimeRepairSubmitIntentKey, setPendingRuntimeRepairSubmitIntentKey] = useState<string | undefined>(undefined)
  const [dismissedRuntimeRepairIntentKey, setDismissedRuntimeRepairIntentKey] = useState<string | undefined>(undefined)
  const visibleRuntimeRepairIntent = useMemo(
    () => runtimeRepairIntent && dismissedRuntimeRepairIntentKey !== runtimeRepairIntent.key
      ? runtimeRepairIntent
      : undefined,
    [dismissedRuntimeRepairIntentKey, runtimeRepairIntent]
  )

  useEffect(() => {
    if (!pendingRuntimeRepairSubmitIntentKey) return
    if (!visibleRuntimeRepairIntent || pendingRuntimeRepairSubmitIntentKey !== visibleRuntimeRepairIntent.key) {
      setPendingRuntimeRepairSubmitIntentKey(undefined)
      return
    }
    setPendingRuntimeRepairSubmitIntentKey(undefined)
    setRuntimeRepairSubmitKey(`runtime-repair-submit-${visibleRuntimeRepairIntent.key}-${Date.now()}`)
    setDismissedRuntimeRepairIntentKey(visibleRuntimeRepairIntent.key)
    emitRuntimeRepairReplayEvent({
      conversationId,
      event: 'runtime.repair.replay.submitted',
      intent: visibleRuntimeRepairIntent,
      trigger: 'one-click-send',
    })
  }, [conversationId, pendingRuntimeRepairSubmitIntentKey, submitDependency, visibleRuntimeRepairIntent])

  const sendRuntimeRepairIntent = useCallback(() => {
    if (!visibleRuntimeRepairIntent) return
    closeOverlays()
    onApplyStarter(visibleRuntimeRepairIntent.prompt)
    setPendingRuntimeRepairSubmitIntentKey(visibleRuntimeRepairIntent.key)
  }, [closeOverlays, onApplyStarter, visibleRuntimeRepairIntent])

  const applyRuntimeRepairIntentDraft = useCallback(() => {
    if (!visibleRuntimeRepairIntent) return
    onApplyStarter(visibleRuntimeRepairIntent.prompt, [], true)
    emitRuntimeRepairReplayEvent({
      conversationId,
      event: 'runtime.repair.replay.applied',
      intent: visibleRuntimeRepairIntent,
      trigger: 'restore-draft',
    })
  }, [conversationId, onApplyStarter, visibleRuntimeRepairIntent])

  const dismissRuntimeRepairIntent = useCallback(() => {
    if (!visibleRuntimeRepairIntent) return
    setDismissedRuntimeRepairIntentKey(visibleRuntimeRepairIntent.key)
    emitRuntimeRepairReplayEvent({
      conversationId,
      event: 'runtime.repair.replay.dismissed',
      intent: visibleRuntimeRepairIntent,
      trigger: 'dismiss',
    })
  }, [conversationId, visibleRuntimeRepairIntent])

  return {
    runtimeRepairSubmitKey,
    visibleRuntimeRepairIntent,
    sendRuntimeRepairIntent,
    applyRuntimeRepairIntentDraft,
    dismissRuntimeRepairIntent,
  }
}
