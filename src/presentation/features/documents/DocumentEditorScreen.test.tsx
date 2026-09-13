import type { ReactNode } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import { act, fireEvent, render } from '@testing-library/react-native'
import { SAVED_DOCUMENT_SCHEMA, parseSavedDocument, type DocumentRepository, type DocumentRevisionPort, type DocumentRevisionSource, type SavedDocument } from '@/modules/documents'
import DocumentEditorScreen from './DocumentEditorScreen'

const mockRoute: { id?: string; conversationId?: string; messageId?: string } = { id: 'saved' }
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockRoute,
  useNavigation: () => ({ dispatch: jest.fn() }),
  useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, [effect]),
  router: { setParams: jest.fn(), replace: jest.fn(), push: jest.fn() },
}))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: jest.requireActual('@/theme/colors').getColors('light', 'minimal') }) }))
jest.mock('@/presentation/app-shell/ThemeDetailFrame', () => ({ ThemeDetailFrame: ({ children, actions }: { children: ReactNode; actions: ReactNode }) => <>{actions}{children}</> }))
jest.mock('react-native-markdown-display', () => ({ children }: { children: ReactNode }) => <>{children}</>)
jest.mock('@/store/chatStore', () => ({ useChatStore: { getState: () => ({ conversations: [], loadAll: async () => undefined }) } }))
jest.mock('@/components/ui/isle', () => {
  const { Pressable, Text, TextInput, View } = jest.requireActual('react-native')
  const Button = ({ label, accessibilityLabel, onPress, disabled, busy }: { label: string; accessibilityLabel?: string; onPress?: () => void; disabled?: boolean; busy?: boolean }) => <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} disabled={disabled || busy} onPress={onPress}><Text>{label}</Text></Pressable>
  return {
    IsleButton: Button,
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
beforeEach(() => { mockRoute.id = 'saved'; delete mockRoute.conversationId; delete mockRoute.messageId })
afterEach(() => jest.restoreAllMocks())

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
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.generate' }))
  await fireEvent.press(view.getByRole('button', { name: 'documents.revision.accept' }))
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
  await fireEvent.press(view.getByRole('button', { name: 'common.save' }))
  expect(f.create).toHaveBeenCalled()
  expect(f.save).not.toHaveBeenCalled()
})
