import { createInstance, type TFunction } from 'i18next'
import * as Clipboard from 'expo-clipboard'
import * as FileSystem from 'expo-file-system/legacy'
import * as Linking from 'expo-linking'
import * as Sharing from 'expo-sharing'

import en from '@/i18n/resources/en.json'
import type { Conversation, Message } from '@/types/chatContracts'

import { copyConversationLinkToClipboard, copySelectedMessagesToClipboard, exportSelectedMessagesMarkdown } from './chatMessageSelectionActions'
import { formatSelectedMessagesForExport } from './messageSelectionFormatting'

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }))
jest.mock('expo-linking', () => ({ createURL: jest.fn() }))
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }))
jest.mock('expo-file-system/legacy', () => ({
  __esModule: true, cacheDirectory: 'file://export-cache/', documentDirectory: null,
  EncodingType: { UTF8: 'utf8' }, writeAsStringAsync: jest.fn(), deleteAsync: jest.fn(),
}))

let t: TFunction
const dialog = { toast: jest.fn(), confirm: jest.fn() }
const message: Message = {
  id: 'answer', role: 'assistant', content: 'Answer [1].', timestamp: 1788854500366, status: 'done',
  citations: [{ id: 'policy', type: 'knowledge', title: 'Atlas pilot policy', excerpt: 'private source content' }],
}
const conversation: Conversation = {
  id: 'chat', title: 'Atlas', providerId: 'unused', model: 'unused', systemPrompt: '', temperature: 0.7,
  maxTokens: 1024, messages: [message], createdAt: 0, updatedAt: 0,
}
const exportMessages = (selectedMessages = [message]) => exportSelectedMessagesMarkdown({ conversation, selectedMessages, dialog, t })

beforeAll(async () => {
  t = await createInstance().init({ lng: 'en', resources: { en: { translation: en } } })
})

beforeEach(() => {
  jest.resetAllMocks()
  Object.assign(FileSystem, { cacheDirectory: 'file://export-cache/', documentDirectory: null })
  dialog.confirm.mockResolvedValue(true)
  jest.mocked(Linking.createURL).mockReturnValue('islemind://chat/chat')
  jest.mocked(Clipboard.setStringAsync).mockResolvedValue(true)
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true)
  jest.mocked(Sharing.shareAsync).mockResolvedValue(undefined)
  jest.mocked(FileSystem.writeAsStringAsync).mockResolvedValue(undefined)
  jest.mocked(FileSystem.deleteAsync).mockResolvedValue(undefined)
})

it('leaves ordinary Copy source-free and does not introduce confirmation or sharing', async () => {
  expect(await copySelectedMessagesToClipboard({ selectedMessages: [message], dialog, t })).toBe(true)
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith(formatSelectedMessagesForExport([message], t))
  expect(dialog.confirm).not.toHaveBeenCalled()
  expect(Sharing.shareAsync).not.toHaveBeenCalled()
})

it.each(['false', 'rejection'])('does not claim an ordinary copy when the clipboard reports %s', async (failure) => {
  if (failure === 'false') jest.mocked(Clipboard.setStringAsync).mockResolvedValueOnce(false)
  else jest.mocked(Clipboard.setStringAsync).mockRejectedValueOnce(new Error('Unavailable'))
  expect(await copySelectedMessagesToClipboard({ selectedMessages: [message], dialog, t })).toBe(false)
  expect(dialog.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: t('chat.clipboardUnavailable'), tone: 'amber' }))
})

it.each(['false', 'rejection'])('does not claim a copied conversation link when the clipboard reports %s', async (failure) => {
  if (failure === 'false') jest.mocked(Clipboard.setStringAsync).mockResolvedValueOnce(false)
  else jest.mocked(Clipboard.setStringAsync).mockRejectedValueOnce(new Error('Unavailable'))
  expect(await copyConversationLinkToClipboard({ conversationId: conversation.id, dialog, t })).toBe(false)
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith('islemind://chat/chat')
  expect(dialog.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: t('chat.clipboardUnavailable'), tone: 'amber' }))
})

it('waits for source-disclosure consent and cancellation has no clipboard or file effect', async () => {
  let settle!: (confirmed: boolean) => void
  dialog.confirm.mockImplementationOnce(() => new Promise<boolean>((resolve) => { settle = resolve }))
  const pending = exportMessages()
  expect(dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ message: t('messageBubble.exportSourcesConfirmMessage') }))
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled()
  settle(false)
  expect(await pending).toBe(false)
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled()
  expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled()
  expect(FileSystem.deleteAsync).not.toHaveBeenCalled()
})

it('copies and shares identical source-aware Markdown, cleans its temporary file, and leaves the conversation unchanged', async () => {
  const before = JSON.stringify(conversation)
  const text = formatSelectedMessagesForExport([message], t, { includeSources: true })
  expect(await exportMessages()).toBe(true)
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith(text)
  expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith('file://export-cache/Atlas-messages.md', text, { encoding: 'utf8' })
  expect(Sharing.shareAsync).toHaveBeenCalledWith('file://export-cache/Atlas-messages.md', expect.objectContaining({ mimeType: 'text/markdown' }))
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file://export-cache/Atlas-messages.md', { idempotent: true })
  expect(dialog.toast).toHaveBeenLastCalledWith(expect.objectContaining({ message: t('messageBubble.multiSelectExportedMessage', { count: 1 }) }))
  expect(JSON.stringify(conversation)).toBe(before)
})

it.each(['no-directory', 'sharing-unavailable', 'availability-error'])('honestly reports clipboard-only export for %s without writing or deleting a file', async (mode) => {
  if (mode === 'no-directory') Object.assign(FileSystem, { cacheDirectory: null })
  if (mode === 'sharing-unavailable') jest.mocked(Sharing.isAvailableAsync).mockResolvedValueOnce(false)
  if (mode === 'availability-error') jest.mocked(Sharing.isAvailableAsync).mockRejectedValueOnce(new Error('Unavailable'))
  expect(await exportMessages()).toBe(true)
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith(expect.stringContaining('Atlas pilot policy'))
  expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled()
  expect(FileSystem.deleteAsync).not.toHaveBeenCalled()
  expect(Sharing.shareAsync).not.toHaveBeenCalled()
  expect(dialog.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: t('common.copied'), message: t('messageBubble.multiSelectExportClipboardFallback') }))
})

it.each(['false', 'rejection'])('does not claim an export or touch files when the clipboard reports %s', async (failure) => {
  if (failure === 'false') jest.mocked(Clipboard.setStringAsync).mockResolvedValueOnce(false)
  else jest.mocked(Clipboard.setStringAsync).mockRejectedValueOnce(new Error('Unavailable'))
  expect(await exportMessages()).toBe(false)
  expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled()
  expect(Sharing.shareAsync).not.toHaveBeenCalled()
  expect(dialog.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: t('messageBubble.multiSelectExportFailed'), tone: 'amber' }))
})

it.each([false, true])('honors the installed Expo Web legacy clipboard result %s and removes its temporary textarea', async (result) => {
  const webClipboard = jest.requireActual('expo-clipboard/build/web/ClipboardModule').default
  const documentBefore = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const navigatorBefore = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const textarea = { textContent: '', select: jest.fn() }
  const documentMock = { createElement: jest.fn(() => textarea), body: { appendChild: jest.fn(), removeChild: jest.fn() }, execCommand: jest.fn(() => result) }
  Object.defineProperty(globalThis, 'document', { configurable: true, value: documentMock })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: jest.fn().mockRejectedValue(new Error('Denied')) } } })
  try {
    jest.mocked(Clipboard.setStringAsync).mockImplementationOnce((text) => webClipboard.setStringAsync(text, {}))
    expect(await exportMessages()).toBe(result)
    expect(documentMock.execCommand).toHaveBeenCalledWith('copy')
    expect(documentMock.body.removeChild).toHaveBeenCalledWith(textarea)
    if (!result) {
      expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled()
      expect(dialog.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: t('messageBubble.multiSelectExportFailed') }))
    }
  } finally {
    if (documentBefore) Object.defineProperty(globalThis, 'document', documentBefore)
    else Reflect.deleteProperty(globalThis, 'document')
    if (navigatorBefore) Object.defineProperty(globalThis, 'navigator', navigatorBefore)
    else Reflect.deleteProperty(globalThis, 'navigator')
  }
})

it.each(['write', 'share'])('retains clipboard success but does not claim sharing after a %s failure, with best-effort cleanup', async (failure) => {
  if (failure === 'write') jest.mocked(FileSystem.writeAsStringAsync).mockRejectedValueOnce(new Error('Disk full'))
  else jest.mocked(Sharing.shareAsync).mockRejectedValueOnce(new Error('Share failed'))
  jest.mocked(FileSystem.deleteAsync).mockRejectedValueOnce(new Error('Cleanup unavailable'))
  expect(await exportMessages()).toBe(true)
  expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(1)
  expect(dialog.toast).toHaveBeenLastCalledWith(expect.objectContaining({ message: t('messageBubble.multiSelectExportClipboardFallback'), tone: 'amber' }))
})

it('does not export an empty selection and does not ask about absent sources', async () => {
  expect(await exportMessages([])).toBe(false)
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled()
  expect(dialog.confirm).not.toHaveBeenCalled()
  expect(await exportMessages([{ ...message, citations: undefined }])).toBe(true)
  expect(dialog.confirm).not.toHaveBeenCalled()
})
