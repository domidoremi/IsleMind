import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IsleButton, useIsleDialog } from '@/components/ui/isle'
import { AppIcon } from '@/components/ui/AppIcon'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useChatStore } from '@/store/chatStore'

export function DeleteAllConversationsButton({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const { colors } = useAppTheme()
  const dialog = useIsleDialog()
  const hasConversations = useChatStore(state => state.historyHasMore
    || state.conversations.some(conversation => !state.draftConversationIds.has(conversation.id)))
  const loading = useChatStore(state => state.isLoading)
  const [deleting, setDeleting] = useState(false)
  const lifetime = useRef<AbortController | undefined>(undefined)
  const locked = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    return () => controller.abort()
  }, [])

  async function removeAll() {
    const signal = lifetime.current?.signal
    if (locked.current || !signal || signal.aborted || !hasConversations || loading) return
    locked.current = true
    try {
      const confirmed = await dialog.confirm({
        title: t('conversation.deleteAll.title'),
        message: t('conversation.deleteAll.confirm'),
        confirmLabel: t('conversation.deleteAll.title'),
        cancelLabel: t('common.cancel'),
        tone: 'danger',
        signal,
      })
      if (!confirmed || signal.aborted) return
      setDeleting(true)
      await useChatStore.getState().clearAll()
      if (!signal.aborted) dialog.toast({ title: t('conversation.deleteAll.done'), tone: 'mint' })
    } catch {
      if (!signal?.aborted) dialog.toast({
        title: t('conversation.deleteAll.failed'),
        message: t('conversation.deleteAll.retryHint'),
        tone: 'danger',
      })
    } finally {
      locked.current = false
      if (!signal?.aborted) setDeleting(false)
    }
  }

  return <IsleButton compact={compact} tone="danger"
    label={t(compact ? 'conversation.deleteAll.short' : 'conversation.deleteAll.title')}
    accessibilityLabel={t('conversation.deleteAll.title')}
    icon={<AppIcon name="delete" color={colors.ui.control.dangerForeground} size={16} />}
    busy={deleting} disabled={!hasConversations || loading || deleting} onPress={() => void removeAll()} />
}
