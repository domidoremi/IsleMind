import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { useChatStore } from '@/store/chatStore'

import { CompressionBanner, ConversationHealthBanner } from './ChatStatusBanners'
import type { ChatActiveWorkspaceActions } from './chatActiveWorkspaceActions'
import type { ChatActiveWorkspaceProps } from './chatActiveWorkspaceTypes'
import { ProgramErrorBanner } from './ProgramErrorBanner'
import { ConversationTaskStatusCard } from './ConversationTaskStatusCard'
import { cancelConversationTask, type ConversationTaskStatusState } from './conversationTaskState'

export type ChatActiveStatusLayerProps = Pick<
  ChatActiveWorkspaceProps,
  | 'conversation'
  | 'providerHealth'
  | 'latestCompression'
  | 'compactViewport'
  | 'visualTopInset'
  | 'topChromeInset'
  | 'goSettings'
  | 'markChromeActive'
  | 'setShowOptions'
  | 'setComposerPanel'
> & {
  activeConversationTaskCount: number
  chromeHeight: number
  primaryConversationTask: ConversationTaskStatusState['primaryConversationTask']
  primaryConversationTaskMessage: ConversationTaskStatusState['primaryConversationTaskMessage']
  providerHealthTopOffset: number
  confirmActionFromMessage: ChatActiveWorkspaceActions['confirmActionFromMessage']
  repairAgentEvidenceFromMessage: ChatActiveWorkspaceActions['repairAgentEvidenceFromMessage']
  safeStopMessage: ChatActiveWorkspaceActions['safeStopMessage']
}

export function ChatActiveStatusLayer({
  conversation: activeConversation,
  providerHealth,
  latestCompression,
  compactViewport,
  visualTopInset,
  topChromeInset,
  goSettings,
  markChromeActive,
  setShowOptions,
  setComposerPanel,
  activeConversationTaskCount,
  chromeHeight,
  primaryConversationTask,
  primaryConversationTaskMessage,
  providerHealthTopOffset,
  confirmActionFromMessage,
  repairAgentEvidenceFromMessage,
  safeStopMessage,
}: ChatActiveStatusLayerProps) {
  const { t } = useTranslation()
  const conversationError = useChatStore((state) => state.error)
  const setError = useChatStore((state) => state.setError)
  const cancellingTaskIdRef = useRef<string | null>(null)
  const [cancellingTaskId, setCancellingTaskId] = useState<string | null>(null)
  const incomingProgramError = conversationError && !isConversationErrorProjected(activeConversation, conversationError)
    ? conversationError
    : null
  const [programError, setProgramError] = useState<string | null>(incomingProgramError)
  const chromeAwareTopOffset = visualTopInset + topChromeInset + chromeHeight + 8
  const showCompressionBanner = Boolean(latestCompression?.metadata) && !programError && !primaryConversationTask && !providerHealth?.code

  useEffect(() => {
    if (incomingProgramError) setProgramError(incomingProgramError)
  }, [incomingProgramError])

  function dismissProgramError() {
    const dismissedError = programError
    setProgramError(null)
    if (dismissedError && conversationError === dismissedError) setError(null)
  }

  function reportTaskCancellationFailure() {
    const message = t('chat.stopFailedMessage')
    setProgramError(message)
    setError(message)
  }

  async function cancelPrimaryConversationTask() {
    const task = primaryConversationTask
    if (!task || cancellingTaskIdRef.current) return

    cancellingTaskIdRef.current = task.id
    setCancellingTaskId(task.id)
    try {
      const outcome = await cancelConversationTask({
        conversation: activeConversation,
        stopStreaming: safeStopMessage,
        task,
      })
      if (outcome === 'failed') reportTaskCancellationFailure()
    } catch {
      reportTaskCancellationFailure()
    } finally {
      if (cancellingTaskIdRef.current === task.id) {
        cancellingTaskIdRef.current = null
        setCancellingTaskId(null)
      }
    }
  }

  return (
    <>
      {programError ? (
        <ProgramErrorBanner
          title={t('chat.programErrorTitle')}
          message={programError}
          topOffset={providerHealthTopOffset}
          compact={compactViewport}
          onDismiss={dismissProgramError}
        />
      ) : null}

      {primaryConversationTask && !programError ? (
        <ConversationTaskStatusCard
          task={primaryConversationTask}
          taskCount={activeConversationTaskCount}
          message={primaryConversationTaskMessage}
          topOffset={Math.max(providerHealthTopOffset, chromeAwareTopOffset)}
          compact={compactViewport}
          cancelling={cancellingTaskId === primaryConversationTask.id}
          onCancel={cancelPrimaryConversationTask}
          onRepairAgentEvidence={repairAgentEvidenceFromMessage}
          onConfirmAction={confirmActionFromMessage}
        />
      ) : null}

      {showCompressionBanner && latestCompression ? (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: chromeAwareTopOffset,
            zIndex: 43,
            elevation: 2,
            paddingHorizontal: 14,
          }}
        >
          <View style={{ width: '100%', maxWidth: 520, alignSelf: 'center' }}>
            <CompressionBanner
              compression={latestCompression}
              onOpenDetails={markChromeActive}
              compact={compactViewport}
            />
          </View>
        </View>
      ) : null}

      {providerHealth?.code && !programError ? (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: providerHealthTopOffset,
            zIndex: 44,
            elevation: 3,
            paddingHorizontal: 14,
          }}
        >
          <View style={{ width: '100%', maxWidth: 520, alignSelf: 'center' }}>
            <ConversationHealthBanner
              health={providerHealth}
              onConfigure={goSettings}
              onSwitch={() => {
                markChromeActive()
                setComposerPanel(null)
                setShowOptions(true)
              }}
              compact
            />
          </View>
        </View>
      ) : null}
    </>
  )
}

function isConversationErrorProjected(
  conversation: ChatActiveWorkspaceProps['conversation'],
  error: string,
): boolean {
  const normalizedError = error.trim()
  if (!normalizedError) return false
  return conversation.messages.some((message) => {
    if (message.role !== 'assistant' || (message.status !== 'error' && message.status !== 'cancelled')) return false
    return [message.content, message.responseText]
      .some((value) => value?.trim() === normalizedError)
  })
}
