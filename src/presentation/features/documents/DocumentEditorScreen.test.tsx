import type { ReactNode } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import { act, fireEvent, render } from '@testing-library/react-native'
import { SAVED_DOCUMENT_SCHEMA, parseSavedDocument, type DocumentRepository, type DocumentRevisionPort, type DocumentRevisionSource, type SavedDocument } from '@/modules/documents'
import DocumentEditorScreen from './DocumentEditorScreen'
import * as Clipboard from 'expo-clipboard'
import type { IsleButtonProps } from '@/components/ui/isle/Controls'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'
import { router } from 'expo-router'
import { usePreventRemove } from 'expo-router/react-navigation'

let mockFamily: CanonicalThemeId = 'minimal'

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('moti', () => ({ MotiView: require('react-native').View }))

const mockRoute: { id?: string; conversationId?: string; messageId?: string } = { id: 'saved' }
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockRoute,
  useNavigation: () => ({ dispatch: jest.fn() }),
  useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, [effect]),
  router: { setParams: jest.fn(), replace: jest.fn(), push: jest.fn(), canGoBack: jest.fn(() => false), back: jest.fn() },
}))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({
  colors: jest.requireActual('@/theme/colors').getColors('light', mockFamily), canonicalThemeId: mockFamily,
}) }))
jest.mock('@/presentation/app-shell/ThemeDetailFrame', () => ({ ThemeDetailFrame: ({ children, actions, onBack }: { children: ReactNode; actions: ReactNode; onBack: () => void }) => {
  const Pressable = require('react-native').Pressable
  return <><Pressable testID="document-back" onPress={onBack} />{actions}{children}</>
} }))
jest.mock('react-native-markdown-display', () => ({ children }: { children: ReactNode }) => {
  const Text = require('react-native').Text
  return <Text>{children}</Text>
})
jest.mock('@/store/chatStore', () => ({ useChatStore: { getState: () => ({ conversations: [], loadAll: async () => undefined }) } }))
jest.mock('@/components/ui/isle', () => {
  const { Pressable, Text, TextInput, View } = jest.requireActual('react-native')
  const { FeedbackAnnouncement, FeedbackGlyph } = jest.requireActual('@/components/ui/FeedbackGlyph')
  const Button = ({ label, accessibilityLabel, onPress, disabled, busy, feedbackPhase, feedbackLabel, testID }: IsleButtonProps) => <Pressable testID={testID} accessibilityRole="button"
    accessibilityLabel={feedbackPhase === 'success' && feedbackLabel ? `${accessibilityLabel ?? label}. ${feedbackLabel}` : accessibilityLabel ?? label}
    disabled={disabled || busy || feedbackPhase === 'pending'} onPress={onPress}>
    <Text>{label}</Text>{feedbackPhase !== undefined ? <FeedbackGlyph phase={feedbackPhase} announce={false} testID={testID ? `${testID}-status` : undefined} /> : null}
    {feedbackPhase !== undefined ? <FeedbackAnnouncement message={feedbackPhase === 'success' ? feedbackLabel : undefined} testID={testID ? `${testID}-announcement` : undefined} /> : null}
  </Pressable>
  return {
    IsleButton: Button,
    IslePressable: Pressable,
    IsleInput: ({ label, inputStyle: _style, ...props }: { label: string; inputStyle: unknown }) => <View><Text>{label}</Text><TextInput {...props} /></View>,
    IsleSelect: ({ options, onChange, disabled }: { options: { label: string; value: string }[]; onChange: (value: string) => void; disabled: boolean }) => <View>{options.map((item) => <Button key={item.value} label={item.label} disabled={disabled} onPress={() => onChange(item.value)} />)}</View>,
    IsleCheckbox: ({ options, onChange, disabled, value }: { options: { label: string; value: string }[]; value: string[]; onChange: (value: string[]) => void; disabled: boolean }) => <View>{options.map((item) => <Button key={item.value} label={item.label} disabled={disabled} onPress={() => onChange(value.includes(item.value) ? value.filter((id) => id !== item.value) : [...value, item.value])} />)}</View>,
    useIsleDialog: () => ({ confirm: async () => true, toast: jest.fn() }),
  }
})

function fixture() {
  let durable: SavedDocument = {
    schema: SAVED_DOCUMENT_SCHEMA, id: 'saved', revision: 'r1', createdAt: 10, updatedAt: 10,
    title: 'Report', body: 'Before body', origin: { conversationId: 'chat', conversationTitle: 'Chat', messageId: 'answer', messageStatus: 'cancelled',
      messageTimestamp: 5, originalText: 'Original interrupted answer', citations: [{ id: 'cite', type: 'knowledge', title: 'Local source', documentId: 'source', excerpt: 'Captured excerpt' }] },
  }
  const get = jest.fn(async () => durable)
  const save = jest.fn(async (_id, _revision, edit) => {
    durable = parseSavedDocument({ ...durable, ...edit, reviewContext: edit.reviewContext === null ? undefined : edit.reviewContext ?? durable.reviewContext, revision: 'r2' })
    return durable
  })
  const create = jest.fn(async () => durable)
  const repository = { get, save, create } as unknown as DocumentRepository
  const source: DocumentRevisionSource = { citationId: 'cite', type: 'knowledge', documentId: 'source', title: 'Local source', updatedAt: 20, text: 'Current full source text.' }
  const port: DocumentRevisionPort = {
    listTargets: jest.fn(() => [{ providerId: 'p', providerName: 'Provider', model: 'model', upstreamModel: 'model', destination: 'http://127.0.0.1:18085/v1' }]),
    readSource: jest.fn(async () => source),
    propose: jest.fn(async () => 'Proposed body'),
  }
  return { repository, port, get, save, create, source, durable: () => durable, replace: () => { durable = { ...durable, body: 'Newer durable body', revision: 'r2' } } }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
type View = Awaited<ReturnType<typeof render>>
async function openRevision(view: View) {
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.open' }))
  await fireEvent.press(view.getByRole('button', { name: 'Provider · model' }))
  await fireEvent.changeText(view.getByTestId('document-revision-instruction'), 'Add the permitted alternative.')
}
beforeEach(() => { jest.clearAllMocks(); jest.mocked(router.canGoBack).mockReturnValue(false); mockFamily = 'minimal'; mockRoute.id = 'saved'; delete mockRoute.conversationId; delete mockRoute.messageId })
afterEach(() => jest.restoreAllMocks())

it('lets an untouched empty new draft leave without reporting lost modifications', async () => {
  delete mockRoute.id
  const f = fixture()
  const view = await render(<DocumentEditorScreen repository={f.repository} revision={f.port} />)
  expect(view.getByTestId('document-body').props.value).toBe('')
  expect(jest.mocked(usePreventRemove).mock.lastCall?.[0]).toBe(false)
  expect(view.getByTestId('document-save-status')).toHaveTextContent('documents.newDraft')
  expect(view.getByTestId('document-save-action')).toBeDisabled()
  expect(view.getByTestId('document-copy')).toBeDisabled()
  expect(f.create).not.toHaveBeenCalled()
})

it('protects actual new-draft edits and becomes pristine again when they are undone', async () => {
  delete mockRoute.id
  const f = fixture()
  const view = await render(<DocumentEditorScreen repository={f.repository} revision={f.port} />)
  const body = view.getByTestId('document-body')
  await fireEvent.changeText(body, 'Keep this unsaved writing.')
  expect(jest.mocked(usePreventRemove).mock.lastCall?.[0]).toBe(true)
  expect(view.getByTestId('document-save-action')).toBeEnabled()
  await fireEvent.changeText(body, '')
  expect(jest.mocked(usePreventRemove).mock.lastCall?.[0]).toBe(false)
  expect(view.getByTestId('document-body')).toBe(body)
  await fireEvent.changeText(view.getByTestId('document-title'), 'A title I intentionally changed')
  expect(jest.mocked(usePreventRemove).mock.lastCall?.[0]).toBe(true)
  expect(f.create).not.toHaveBeenCalled()
})

it('exposes writing modes and source expansion without saving, generating, or losing the current body', async () => {
  const f = fixture()
  const view = await render(<DocumentEditorScreen repository={f.repository} revision={f.port} />)
  const body = view.getByTestId('document-body')
  await fireEvent.changeText(body, 'A human draft, not a generated proposal.')
  expect(view.getByTestId('document-mode-edit').props.accessibilityState.selected).toBe(true)
  expect(view.getByTestId('document-origin-toggle').props.accessibilityState.expanded).toBe(false)
  await fireEvent.press(view.getByTestId('document-origin-toggle'))
  expect(view.getByTestId('document-origin-toggle').props.accessibilityState.expanded).toBe(true)
  expect(view.getByTestId('document-body')).toBe(body)
  expect(view.getByTestId('document-origin')).toBeTruthy()
  await fireEvent.press(view.getByTestId('document-origin-toggle'))
  expect(view.queryByTestId('document-origin')).toBeNull()
  await fireEvent.press(view.getByTestId('document-mode-preview'))
  expect(view.getByTestId('document-mode-preview').props.accessibilityState.selected).toBe(true)
  expect(view.getByTestId('document-preview')).toHaveTextContent(/A human draft, not a generated proposal./)
  await fireEvent.press(view.getByTestId('document-mode-edit'))
  expect(view.getByTestId('document-body').props.value).toBe('A human draft, not a generated proposal.')
  expect(f.save).not.toHaveBeenCalled()
  expect(f.create).not.toHaveBeenCalled()
  expect(f.port.propose).not.toHaveBeenCalled()
})

it('keeps body, title, toolbar, and save-state identity while changing theme presentation', async () => {
  const f = fixture()
  const page = () => <DocumentEditorScreen repository={f.repository} revision={f.port} />
  const view = await render(page())
  const body = view.getByTestId('document-body')
  const title = view.getByTestId('document-title')
  const status = view.getByTestId('document-save-status')
  const toolbar = view.getByTestId('document-editor-toolbar')
  await fireEvent.changeText(body, 'A draft that survives appearance changes.')
  for (const family of CANONICAL_THEME_IDS) {
    mockFamily = family
    await view.rerender(page())
    expect(view.getByTestId('document-body')).toBe(body)
    expect(view.getByTestId('document-title')).toBe(title)
    expect(view.getByTestId('document-save-status')).toBe(status)
    expect(view.getByTestId('document-editor-toolbar')).toBe(toolbar)
    expect(body.props.value).toBe('A draft that survives appearance changes.')
  }
  expect(f.save).not.toHaveBeenCalled()
  expect(f.port.propose).not.toHaveBeenCalled()
})

it('keeps the editor mounted across preview and restores focus only when explicitly returning to writing', async () => {
  const f = fixture()
  const view = await render(<DocumentEditorScreen repository={f.repository} revision={f.port} />)
  const body = view.getByTestId('document-body')
  await fireEvent.changeText(body, 'A draft with a retained caret.')
  await fireEvent(body, 'selectionChange', { nativeEvent: { selection: { start: 7, end: 12 } } })
  await fireEvent.press(view.getByTestId('document-mode-preview'))
  expect(view.getByTestId('document-body', { includeHiddenElements: true })).toBe(body)
  expect(view.queryByTestId('document-body')).toBeNull()
  expect(view.getByTestId('document-preview')).toHaveTextContent(/A draft with a retained caret\./)
  await fireEvent.press(view.getByTestId('document-mode-edit'))
  expect(view.getByTestId('document-body')).toBe(body)
  expect(body.props.value).toBe('A draft with a retained caret.')
  expect(f.save).not.toHaveBeenCalled()
  expect(f.port.propose).not.toHaveBeenCalled()
})

it.each(['route', 'unmount'] as const)('cancels pending writing focus on %s before the next frame', async (change) => {
  const request = jest.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(73)
  const cancel = jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {})
  const f = fixture()
  const view = await render(<DocumentEditorScreen repository={f.repository} revision={f.port} />)
  await fireEvent.press(view.getByTestId('document-mode-preview'))
  await fireEvent.press(view.getByTestId('document-mode-edit'))
  expect(request).toHaveBeenCalledTimes(1)
  if (change === 'route') {
    delete mockRoute.id
    await view.rerender(<DocumentEditorScreen repository={f.repository} revision={f.port} />)
    expect(view.getByTestId('document-body').props.value).toBe('')
  } else await view.unmount()
  expect(cancel).toHaveBeenCalledWith(73)
  expect(f.save).not.toHaveBeenCalled()
  expect(f.port.propose).not.toHaveBeenCalled()
})

it('marks writing focus without changing the writing surface geometry', async () => {
  const f = fixture()
  const view = await render(<DocumentEditorScreen repository={f.repository} revision={f.port} />)
  const frame = view.getByTestId('document-writing-frame')
  const { StyleSheet } = require('react-native')
  const idle = StyleSheet.flatten(frame.props.style)
  await fireEvent(view.getByTestId('document-body'), 'focus')
  const focused = StyleSheet.flatten(frame.props.style)
  expect(focused.borderColor).not.toBe(idle.borderColor)
  expect(focused.borderWidth).toBe(idle.borderWidth)
  expect(focused.padding).toBe(idle.padding)
  await fireEvent(view.getByTestId('document-body'), 'blur')
  expect(view.getByTestId('document-writing-frame')).toHaveStyle({ borderColor: idle.borderColor })
})

it('keeps the writing tree while switching between wide and large-text layouts', async () => {
  const dimensions = jest.spyOn(require('react-native'), 'useWindowDimensions')
  dimensions.mockReturnValue({ width: 1280, height: 900, fontScale: 1, scale: 1 })
  const f = fixture()
  const page = () => <DocumentEditorScreen repository={f.repository} revision={f.port} />
  const view = await render(page())
  const body = view.getByTestId('document-body')
  const title = view.getByTestId('document-title')
  const toolbar = view.getByTestId('document-editor-toolbar')
  await fireEvent.changeText(body, 'A wide draft.')
  expect(view.getByTestId('document-workspace')).toHaveStyle({ flexDirection: 'row' })
  dimensions.mockReturnValue({ width: 1280, height: 900, fontScale: 1.6, scale: 1 })
  await view.rerender(page())
  expect(view.getByTestId('document-workspace')).toHaveStyle({ flexDirection: 'column' })
  expect(view.getByTestId('document-body')).toBe(body)
  expect(view.getByTestId('document-title')).toBe(title)
  expect(view.getByTestId('document-editor-toolbar')).toBe(toolbar)
  expect(body.props.value).toBe('A wide draft.')
  expect(f.save).not.toHaveBeenCalled()
})

it('keeps storage explanations behind an explicit disclosure rather than the writing flow', async () => {
  const f = fixture()
  const view = await render(<DocumentEditorScreen repository={f.repository} revision={f.port} />)
  const body = view.getByTestId('document-body')
  expect(view.queryByText('documents.retentionNotice')).toBeNull()
  await fireEvent.press(view.getByTestId('document-storage-toggle'))
  expect(view.getByText('documents.retentionNotice')).toBeTruthy()
  expect(view.getByTestId('document-body')).toBe(body)
  expect(f.save).not.toHaveBeenCalled()
})

it('returns to the existing caller rather than replacing its route with a new library', async () => {
  jest.mocked(router.canGoBack).mockReturnValue(true)
  const f = fixture()
  const view = await render(<DocumentEditorScreen repository={f.repository} revision={f.port} />)
  await fireEvent.press(view.getByTestId('document-back'))
  expect(router.back).toHaveBeenCalledTimes(1)
  expect(router.replace).not.toHaveBeenCalled()
  expect(f.save).not.toHaveBeenCalled()
})

it('uses the explicit source conversation when a document opened from an answer has no back stack', async () => {
  mockRoute.conversationId = 'origin-chat'; mockRoute.messageId = 'answer'
  const f = fixture()
  const view = await render(<DocumentEditorScreen repository={f.repository} revision={f.port} />)
  await fireEvent.press(view.getByTestId('document-back'))
  expect(router.replace).toHaveBeenCalledWith({ pathname: '/chat/[id]', params: { id: 'origin-chat' } })
  expect(f.save).not.toHaveBeenCalled()
})

it.each(['success', 'false', 'reject'] as const)('confirms only a real document-copy outcome: %s', async outcome => {
  if (outcome === 'reject') jest.mocked(Clipboard.setStringAsync).mockRejectedValueOnce(new Error('Clipboard unavailable'))
  else jest.mocked(Clipboard.setStringAsync).mockResolvedValueOnce(outcome === 'success')
  const f = fixture()
  const view = await render(<DocumentEditorScreen repository={f.repository} revision={f.port} />)
  await fireEvent.changeText(view.getByTestId('document-body'), 'Draft to copy, not save.')
  await fireEvent.press(view.getByRole('button', { name: 'documents.copyText' }))
  expect(Clipboard.setStringAsync).toHaveBeenLastCalledWith('Draft to copy, not save.')
  expect(view.getByTestId('document-body').props.value).toBe('Draft to copy, not save.')
  expect(f.save).not.toHaveBeenCalled()
  if (outcome === 'success') {
    expect(view.queryByTestId('document-copy-announcement')).toBeNull()
    expect(view.getByRole('button', { name: 'documents.copyText. common.copied' })).toBeTruthy()
    expect(view.queryByTestId('document-copy-feedback')).toBeNull()
  }
  else {
    expect(view.getByTestId('document-copy-status').props.accessibilityLabel).toBeUndefined()
    expect(view.getByText('chat.clipboardUnavailable')).toBeTruthy()
  }
})

it('requires explicit generation, review, acceptance and then a separate revision-fenced Save; immutable origin stays cancelled', async () => {
  const f = fixture()
  const originalOrigin = f.durable().origin
  const view = await render(<DocumentEditorScreen repository={f.repository} revision={f.port} />)
  await openRevision(view)
  expect(f.port.propose).not.toHaveBeenCalled()
  expect(f.port.readSource).not.toHaveBeenCalled()
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.generate' }))
  expect(view.getByTestId('document-revision-before').props.children).toBe('Before body')
  expect(view.getByTestId('document-revision-proposed').props.children).toBe('Proposed body')
  expect(view.getByTestId('document-body').props.value).toBe('Before body')
  expect(f.save).not.toHaveBeenCalled()
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.accept' }))
  expect(view.getByTestId('document-body').props.value).toBe('Proposed body')
  expect(view.getByTestId('document-save-status').props.children).toBe('documents.unsaved')
  expect(f.save).not.toHaveBeenCalled()
  expect(f.durable().body).toBe('Before body')
  await fireEvent.press(view.getByRole('button', { name: 'common.save' }))
  expect(f.save).toHaveBeenCalledWith('saved', 'r1', expect.objectContaining({ body: 'Proposed body' }))
  expect(f.durable().origin).toEqual(originalOrigin)
  expect(f.durable().origin?.messageStatus).toBe('cancelled')
})

it('reads only on demand and sends a source only after an explicit include selection', async () => {
  const f = fixture()
  const view = await render(<DocumentEditorScreen repository={f.repository} revision={f.port} />)
  await openRevision(view)
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.readSource' }))
  expect(view.getByTestId('document-revision-source-cite').props.children).toBe(f.source.text)
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.generate' }))
  expect((f.port.propose as jest.Mock).mock.calls[0][0].sources).toEqual([])
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.includeSource' }))
  expect(view.queryByTestId('document-revision-proposal')).toBeNull()
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.generate' }))
  expect((f.port.propose as jest.Mock).mock.calls[1][0].sources).toEqual([f.source])
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.reject' }))
  expect(view.getByTestId('document-body').props.value).toBe('Before body')
  expect(f.save).not.toHaveBeenCalled()
})

it('ordinary acceptance saves only the body, so reviewed text and its labels are unavailable after reopening', async () => {
  const f = fixture()
  const view = await render(<DocumentEditorScreen repository={f.repository} revision={f.port} />)
  await openRevision(view)
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.readSource' }))
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.includeSource' }))
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.generate' }))
  expect(view.getByTestId('document-revision-source-cite').props.children).toBe(f.source.text)
  expect(view.getByTestId('document-revision-proposal')).toBeTruthy()
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.accept' }))
  await fireEvent.press(view.getByRole('button', { name: 'common.save' }))
  expect(JSON.stringify(f.durable())).not.toContain(f.source.text)
  await view.unmount()
  const reopened = await render(<DocumentEditorScreen repository={f.repository} revision={f.port} />)
  expect(reopened.getByTestId('document-body').props.value).toBe('Proposed body')
  expect(reopened.queryByText(f.source.text)).toBeNull()
  expect(reopened.queryByTestId('document-review-context')).toBeNull()
  expect(f.port.readSource).toHaveBeenCalledTimes(1)
})

it('explicitly retains exact selection order with the accepted proposal through Save and reopen without rereading sources', async () => {
  const f = fixture()
  const second: DocumentRevisionSource = { citationId: 'second', type: 'knowledge', documentId: 'source-2', title: 'Second source', updatedAt: 30, text: 'Second source — exact retained text.\n' }
  f.durable().origin!.citations.push({ id: 'second', type: 'knowledge', title: second.title, documentId: second.documentId })
  ;(f.port.readSource as jest.Mock).mockImplementation(async (_origin, id) => id === 'second' ? second : f.source)
  const origin = JSON.parse(JSON.stringify(f.durable().origin))
  const view = await render(<DocumentEditorScreen repository={f.repository} revision={f.port} />)
  await openRevision(view)
  await fireEvent.press(view.getAllByRole('button', { name: 'documents.revision.readSource' })[1])
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.includeSource' }))
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.readSource' }))
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.includeSource' }))
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.generate' }))
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.acceptWithSources' }))
  expect(f.save).not.toHaveBeenCalled()
  expect(view.getByTestId('document-review-source-0').props.children).toBe(second.text)
  expect(view.getByTestId('document-review-source-1').props.children).toBe(f.source.text)
  await fireEvent.press(view.getByRole('button', { name: 'common.save' }))
  const retained = JSON.parse(JSON.stringify(f.durable().reviewContext))
  expect(retained).toMatchObject({ title: 'Report', body: 'Proposed body', sources: [second, f.source] })
  expect(f.durable().origin).toEqual(origin)
  second.text = 'The live source has changed.'
  await view.unmount()
  const reopened = await render(<DocumentEditorScreen repository={f.repository} revision={f.port} />)
  await fireEvent.press(reopened.getByRole('button', { name: 'documents.review.show' }))
  expect(reopened.getByTestId('document-review-source-0').props.children).toBe(retained.sources[0].text)
  expect(reopened.getByTestId('document-review-source-1').props.children).toBe(retained.sources[1].text)
  expect(f.port.readSource).toHaveBeenCalledTimes(2)
  expect(f.port.propose).toHaveBeenCalledTimes(1)
  await fireEvent.changeText(reopened.getByTestId('document-body'), 'Later human edit')
  expect(reopened.getByText('documents.review.changed')).toBeTruthy()
  expect(reopened.getByTestId('document-review-body').props.children).toBe('Proposed body')
  await fireEvent.press(reopened.getByRole('button', { name: 'common.save' }))
  expect(f.durable().reviewContext).toEqual(retained)
  await fireEvent.press(reopened.getByRole('button', { name: 'documents.review.remove' }))
  expect(reopened.queryByTestId('document-review-context')).toBeNull()
  expect(reopened.getByTestId('document-save-status').props.children).toBe('documents.unsaved')
  expect(f.durable().reviewContext).toEqual(retained)
  await fireEvent.press(reopened.getByRole('button', { name: 'common.save' }))
  expect(f.durable().reviewContext).toBeUndefined()
  expect(f.durable().body).toBe('Later human edit')
})

it('keeps an opted-in review only in the draft when Save fails, then retries without losing the reviewed bytes', async () => {
  const f = fixture()
  f.save.mockRejectedValueOnce(new Error('write failed'))
  const view = await render(<DocumentEditorScreen repository={f.repository} revision={f.port} />)
  await openRevision(view)
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.readSource' }))
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.includeSource' }))
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.generate' }))
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.acceptWithSources' }))
  await fireEvent.press(view.getByRole('button', { name: 'common.save' }))
  expect(view.getByText('documents.saveFailed')).toBeTruthy()
  expect(view.getByTestId('document-save-status').props.children).toBe('documents.unsaved')
  expect(view.getByTestId('document-review-source-0').props.children).toBe(f.source.text)
  expect(f.durable().reviewContext).toBeUndefined()
  expect(f.durable().body).toBe('Before body')
  await fireEvent.press(view.getByRole('button', { name: 'common.save' }))
  expect(f.durable().reviewContext?.sources).toEqual([f.source])
  // Ordinary later acceptance does not silently discard or relabel that review.
  const retained = f.durable().reviewContext
  ;(f.port.propose as jest.Mock).mockResolvedValueOnce('Later proposal without retained sources')
  await fireEvent.press(view.getByTestId('document-revision-toggle'))
  await fireEvent.press(view.getByRole('button', { name: 'Provider · model' }))
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.generate' }))
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.accept' }))
  await fireEvent.press(view.getByTestId('document-review-toggle'))
  expect(view.getByText('documents.review.changed')).toBeTruthy()
  await fireEvent.press(view.getByRole('button', { name: 'common.save' }))
  expect(f.durable().reviewContext).toEqual(retained)
})

it('cancels an old request without accepting late results or letting it overwrite a newer proposal', async () => {
  const f = fixture()
  const gate = deferred<string>()
  ;(f.port.propose as jest.Mock).mockReturnValueOnce(gate.promise).mockResolvedValueOnce('New proposal')
  const view = await render(<DocumentEditorScreen repository={f.repository} revision={f.port} />)
  await openRevision(view)
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.generate' }))
  await fireEvent.press(view.getByRole('button', { name: 'common.cancel' }))
  expect((f.port.propose as jest.Mock).mock.calls[0][1].aborted).toBe(true)
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.generate' }))
  await act(async () => gate.resolve('Late old proposal'))
  expect(view.getByTestId('document-revision-proposed').props.children).toBe('New proposal')
  expect(view.getByTestId('document-body').props.value).toBe('Before body')
  expect(f.save).not.toHaveBeenCalled()
})

it('keeps one contextual task open and preserves the revision instruction when changing context', async () => {
  const f = fixture()
  const view = await render(<DocumentEditorScreen repository={f.repository} revision={f.port} />)
  const title = view.getByTestId('document-title')
  const body = view.getByTestId('document-body')
  await openRevision(view)
  const instruction = view.getByTestId('document-revision-instruction')
  const text = instruction.props.value
  await fireEvent.press(view.getByTestId('document-origin-toggle'))
  expect(view.getByTestId('document-origin')).toBeTruthy()
  expect(view.queryByRole('button', { name: 'documents.revision.generate' })).toBeNull()
  expect(view.getByTestId('document-revision-toggle').props.accessibilityState.expanded).toBe(false)
  await fireEvent.press(view.getByTestId('document-storage-toggle'))
  expect(view.queryByTestId('document-origin')).toBeNull()
  expect(view.getByText('documents.retentionNotice')).toBeTruthy()
  await fireEvent.press(view.getByTestId('document-revision-toggle'))
  expect(view.getByTestId('document-revision-instruction')).toBe(instruction)
  expect(instruction.props.value).toBe(text)
  expect(view.queryByTestId('document-revision-destination')).toBeNull()
  expect(view.getByTestId('document-title')).toBe(title)
  expect(view.getByTestId('document-body')).toBe(body)
  expect(f.save).not.toHaveBeenCalled()
  expect(f.port.readSource).not.toHaveBeenCalled()
  expect(f.port.propose).not.toHaveBeenCalled()
})

it('cancels a revision when leaving its context and rejects its late result', async () => {
  const f = fixture()
  const gate = deferred<string>()
  ;(f.port.propose as jest.Mock).mockReturnValueOnce(gate.promise)
  const view = await render(<DocumentEditorScreen repository={f.repository} revision={f.port} />)
  await openRevision(view)
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.generate' }))
  const signal = (f.port.propose as jest.Mock).mock.calls[0][1] as AbortSignal
  await fireEvent.press(view.getByTestId('document-storage-toggle'))
  expect(signal.aborted).toBe(true)
  await act(() => gate.resolve('A late response must not become a proposal'))
  await fireEvent.press(view.getByTestId('document-revision-toggle'))
  expect(view.queryByTestId('document-revision-proposal')).toBeNull()
  expect(view.getByTestId('document-body').props.value).toBe('Before body')
  expect(f.save).not.toHaveBeenCalled()
})

it('invalidates in-flight proposals when the user edits, even if the old text is later restored', async () => {
  const f = fixture()
  const gate = deferred<string>()
  ;(f.port.propose as jest.Mock).mockReturnValue(gate.promise)
  const view = await render(<DocumentEditorScreen repository={f.repository} revision={f.port} />)
  await openRevision(view)
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.generate' }))
  await fireEvent.changeText(view.getByTestId('document-body'), 'New edit')
  await fireEvent.changeText(view.getByTestId('document-body'), 'Before body')
  expect((f.port.propose as jest.Mock).mock.calls[0][1].aborted).toBe(true)
  await act(async () => gate.resolve('Stale proposal'))
  expect(view.queryByTestId('document-revision-proposal')).toBeNull()
  expect(f.save).not.toHaveBeenCalled()
})

it.each(['documents.revision.accept', 'documents.revision.acceptWithSources'])('does not apply %s over a concurrently changed durable revision', async (acceptAction) => {
  const f = fixture()
  const view = await render(<DocumentEditorScreen repository={f.repository} revision={f.port} />)
  await openRevision(view)
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.readSource' }))
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.includeSource' }))
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.generate' }))
  f.replace()
  await fireEvent.press(view.getByRole('button', { name: acceptAction }))
  expect(view.getByTestId('document-body').props.value).toBe('Before body')
  expect(view.getByText('documents.conflict')).toBeTruthy()
  expect(f.save).not.toHaveBeenCalled()
  expect(f.durable().body).toBe('Newer durable body')
  expect(f.durable().reviewContext).toBeUndefined()
  await fireEvent.press(view.getByRole('button', { name: 'documents.reload' }))
  expect(view.getByTestId('document-body').props.value).toBe('Newer durable body')
  expect(view.queryByTestId('document-revision-proposal')).toBeNull()
})

it('cancels on backgrounding and unmount without persisting an interrupted proposal', async () => {
  const f = fixture()
  const gate = deferred<string>()
  ;(f.port.propose as jest.Mock).mockReturnValue(gate.promise)
  let change!: (state: AppStateStatus) => void
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => { change = listener; return { remove: jest.fn() } })
  const view = await render(<DocumentEditorScreen repository={f.repository} revision={f.port} />)
  await openRevision(view)
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.generate' }))
  await act(async () => change('background'))
  expect((f.port.propose as jest.Mock).mock.calls[0][1].aborted).toBe(true)
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.generate' }))
  await view.unmount()
  expect((f.port.propose as jest.Mock).mock.calls[1][1].aborted).toBe(true)
  await act(async () => gate.resolve('Late text'))
  expect(f.save).not.toHaveBeenCalled()
})

it('clears the previous saved identity on a blank-document route change and cancels its proposal', async () => {
  const f = fixture()
  const gate = deferred<string>()
  ;(f.port.propose as jest.Mock).mockReturnValue(gate.promise)
  const view = await render(<DocumentEditorScreen repository={f.repository} revision={f.port} />)
  await openRevision(view)
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.generate' }))
  delete mockRoute.id
  await view.rerender(<DocumentEditorScreen repository={f.repository} revision={f.port} />)
  expect((f.port.propose as jest.Mock).mock.calls[0][1].aborted).toBe(true)
  await act(async () => gate.resolve('Stale route proposal'))
  expect(view.getByTestId('document-body').props.value).toBe('')
  expect(view.getByTestId('document-save-action')).toBeDisabled()
  expect(f.create).not.toHaveBeenCalled()
  await fireEvent.changeText(view.getByTestId('document-body'), 'A new document from this route.')
  await fireEvent.press(view.getByRole('button', { name: 'common.save' }))
  expect(f.create).toHaveBeenCalled()
  expect(f.save).not.toHaveBeenCalled()
})
