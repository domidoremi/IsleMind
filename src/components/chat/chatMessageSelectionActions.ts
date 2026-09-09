import type { TFunction } from 'i18next'
import * as Clipboard from 'expo-clipboard'
import * as FileSystem from 'expo-file-system/legacy'
import * as Linking from 'expo-linking'
import * as Sharing from 'expo-sharing'

import type { Conversation, Message } from '@/types/chatContracts'

import { buildSelectedMessagesExportFileName, formatSelectedMessagesForExport } from './messageSelectionFormatting'

export type MessageActionDialog = {
  toast: (options: { title: string; message?: string; tone: 'mint' | 'amber' }) => void
  confirm: (options: {
    title: string
    message: string
    confirmLabel: string
    cancelLabel: string
    tone: 'danger' | 'mint'
  }) => Promise<boolean>
}

export async function copyConversationLinkToClipboard({
  conversationId,
  dialog,
  t,
}: {
  conversationId: string
  dialog: MessageActionDialog
  t: TFunction
}) {
  const url = Linking.createURL(`/chat/${conversationId}`)
  const copied = await Clipboard.setStringAsync(url).catch(() => false)
  if (!copied) {
    dialog.toast({ title: t('chat.clipboardUnavailable'), tone: 'amber' })
    return false
  }
  dialog.toast({ title: t('chat.linkCopied'), message: url, tone: 'mint' })
  return true
}

export async function copySelectedMessagesToClipboard({
  selectedMessages,
  dialog,
  t,
}: {
  selectedMessages: Message[]
  dialog: MessageActionDialog
  t: TFunction
}): Promise<boolean> {
  if (!selectedMessages.length) {
    dialog.toast({ title: t('messageBubble.multiSelectNone'), tone: 'amber' })
    return false
  }
  const text = formatSelectedMessagesForExport(selectedMessages, t)
  const copied = await Clipboard.setStringAsync(text).catch(() => false)
  if (!copied) {
    dialog.toast({ title: t('chat.clipboardUnavailable'), tone: 'amber' })
    return false
  }
  dialog.toast({ title: t('common.copied'), message: t('messageBubble.multiSelectCopied', { count: selectedMessages.length }), tone: 'mint' })
  return true
}

export async function exportSelectedMessagesMarkdown({
  conversation,
  selectedMessages,
  dialog,
  t,
}: {
  conversation: Conversation
  selectedMessages: Message[]
  dialog: MessageActionDialog
  t: TFunction
}): Promise<boolean> {
  if (!selectedMessages.length) {
    dialog.toast({ title: t('messageBubble.multiSelectNone'), tone: 'amber' })
    return false
  }

  const text = formatSelectedMessagesForExport(selectedMessages, t, { includeSources: true })
  if (selectedMessages.some((message) => message.citations?.length)) {
    const confirmed = await dialog.confirm({
      title: t('messageBubble.exportSourcesConfirmTitle'),
      message: t('messageBubble.exportSourcesConfirmMessage'),
      confirmLabel: t('messageBubble.export'),
      cancelLabel: t('common.cancel'),
      tone: 'mint',
    })
    if (!confirmed) return false
  }

  const copied = await Clipboard.setStringAsync(text).catch(() => false)
  if (!copied) {
    dialog.toast({ title: t('messageBubble.multiSelectExportFailed'), message: t('chat.clipboardUnavailable'), tone: 'amber' })
    return false
  }
  const exportFileName = buildSelectedMessagesExportFileName(conversation.title, conversation.id)
  const exportDirectory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory
  if (!exportDirectory || !(await Sharing.isAvailableAsync().catch(() => false))) {
    dialog.toast({ title: t('common.copied'), message: t('messageBubble.multiSelectExportClipboardFallback'), tone: 'mint' })
    return true
  }

  const uri = `${exportDirectory}${exportFileName}`
  try {
    await FileSystem.writeAsStringAsync(uri, text, { encoding: FileSystem.EncodingType.UTF8 })
    await Sharing.shareAsync(uri, {
      mimeType: 'text/markdown',
      dialogTitle: exportFileName,
      UTI: 'net.daringfireball.markdown',
    })
    dialog.toast({ title: t('messageBubble.multiSelectExported'), message: t('messageBubble.multiSelectExportedMessage', { count: selectedMessages.length }), tone: 'mint' })
    return true
  } catch {
    // The clipboard copy succeeded, but opening a share target is not a save.
    dialog.toast({ title: t('common.copied'), message: t('messageBubble.multiSelectExportClipboardFallback'), tone: 'amber' })
    return true
  } finally {
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined)
  }
}

export async function deleteSelectedMessagesWithConfirmation({
  conversation,
  selectedMessages,
  dialog,
  t,
  updateConversation,
}: {
  conversation: Conversation
  selectedMessages: Message[]
  dialog: MessageActionDialog
  t: TFunction
  updateConversation: (id: string, updates: Partial<Conversation>) => void
}): Promise<number> {
  if (!selectedMessages.length) {
    dialog.toast({ title: t('messageBubble.multiSelectNone'), tone: 'amber' })
    return 0
  }
  const confirmed = await dialog.confirm({
    title: t('messageBubble.multiSelectDeleteTitle', { count: selectedMessages.length }),
    message: t('messageBubble.multiSelectDeleteMessage'),
    confirmLabel: t('common.delete'),
    cancelLabel: t('common.cancel'),
    tone: 'danger',
  })
  if (!confirmed) return 0

  const selected = new Set(selectedMessages.map((message) => message.id))
  updateConversation(conversation.id, {
    messages: conversation.messages.filter((message) => !selected.has(message.id)),
  })
  dialog.toast({ title: t('messageBubble.multiSelectDeleted'), message: t('messageBubble.multiSelectDeletedMessage', { count: selected.size }), tone: 'mint' })
  return selected.size
}
