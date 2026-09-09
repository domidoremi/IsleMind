import type { ReactNode } from 'react'
import { Linking, Text } from 'react-native'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import type { KnowledgeLocalSource, KnowledgeLocalSourceReader } from '@/modules/knowledge'
import type { MessageCitation } from '@/types/contextContracts'
import { CanonicalSourceReader, type CanonicalSourceReaderProps } from './CanonicalSourceReader'
import SourceDetailScreen from './SourceDetailScreen'

jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, [effect]),
  useLocalSearchParams: jest.fn(),
  router: { setParams: jest.fn(), canGoBack: () => false, replace: jest.fn() },
}))
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
jest.mock('@/hooks/useAppTheme', () => ({
  useAppTheme: () => ({ colors: jest.requireActual('@/theme/colors').getColors('light', 'minimal') }),
}))
jest.mock('@/components/ui/isle', () => {
  const { Pressable, Text, View } = jest.requireActual('react-native')
  const Button = ({ label, onPress }: { label: string; onPress: () => void }) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}><Text>{label}</Text></Pressable>
  )
  return {
    IsleButton: Button, IsleIconButton: Button, IslePanel: View, IsleChip: Text,
    IsleSection: ({ title, children }: { title: string; children: ReactNode }) => <View><Text>{title}</Text>{children}</View>,
    useIsleDialog: () => ({ toast: jest.fn() }),
  }
})
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('@/components/ui/RenderGuard', () => ({ RenderGuard: ({ children }: { children: ReactNode }) => children }))
jest.mock('@/presentation/app-shell/ThemeDetailFrame', () => ({
  ThemeDetailFrame: ({ children, actions }: { children: ReactNode; actions: ReactNode }) => <>{actions}{children}</>,
}))
jest.mock('@/store/chatStore', () => ({ useChatStore: jest.fn() }))
jest.mock('@/components/chat/tracePresentation', () => ({ collectVisibleProcessTraces: () => [], normalizeTraceStatuses: () => [] }))
jest.mock('react-native-webview', () => ({ WebView: jest.fn(() => null) }))

const { useLocalSearchParams, router } = jest.requireMock('expo-router')
const { useChatStore } = jest.requireMock('@/store/chatStore')
const { WebView } = jest.requireMock('react-native-webview')
type Read = KnowledgeLocalSourceReader['readLocalSource']

const citation: MessageCitation = {
  id: 'citation-a', type: 'knowledge', title: 'Cited document', excerpt: 'Captured excerpt',
  documentId: 'document-a', chunkId: 'chunk-1', chunkIndex: 0,
}
function documentSource(): Extract<KnowledgeLocalSource, { type: 'knowledge' }> {
  return {
    type: 'knowledge',
    document: { schema: 'islemind.knowledge-document-record.v1', id: 'document-a', title: 'Saved document',
      mimeType: 'text/plain', size: 128, chunkCount: 2, status: 'ready', createdAt: 1_000, updatedAt: 2_000 },
    chunks: [0, 1].map((ordinal) => ({
      schema: 'islemind.knowledge-chunk-record.v1', id: `chunk-${ordinal}`, documentId: 'document-a',
      title: 'Saved document', ordinal, content: `Full saved section ${ordinal}: beyond the captured excerpt. 日本語 😀`, createdAt: 1_000,
    })),
  }
}
function readerProps(readLocalSource: Read): CanonicalSourceReaderProps {
  return { conversationId: 'conversation-a', messageId: 'message-a', messageTimestamp: 1_500, citation,
    readLocalSource, header: <Text>{citation.excerpt}</Text> }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => { resolve = settle })
  return { promise, resolve }
}

describe('CanonicalSourceReader', () => {
  it('shows the full exact cited section, not the ordinal match, and can show all retained sections', async () => {
    const source = documentSource()
    const read = jest.fn<ReturnType<Read>, Parameters<Read>>().mockResolvedValue(source)
    const view = await render(<CanonicalSourceReader {...readerProps(read)} />)
    expect(read.mock.calls[0][0]).toEqual({ type: 'knowledge', documentId: 'document-a' })
    expect(view.getByText(source.chunks[1].content).props.selectable).toBe(true)
    expect(view.queryByText(source.chunks[0].content)).toBeNull()
    expect(view.getByText('Captured excerpt')).toBeTruthy()
    expect(view.getByText('source.currentSavedSourceNotice')).toBeTruthy()
    expect(view.getByText('source.updatedAfterResponse')).toBeTruthy()
    await fireEvent.press(view.getByRole('button', { name: 'source.showAllSavedSections' }))
    expect(view.getByText(source.chunks[0].content)).toBeTruthy()
    await fireEvent.press(view.getByRole('button', { name: 'source.showCitedSection' }))
    expect(view.queryByText(source.chunks[0].content)).toBeNull()
  })

  it('refreshes replacement and deletion honestly while retaining the captured evidence', async () => {
    const source = documentSource()
    const replacement = { ...source, chunks: [{ ...source.chunks[0], id: 'replacement', content: 'New revision' }] }
    const read = jest.fn<ReturnType<Read>, Parameters<Read>>()
      .mockResolvedValueOnce(source).mockResolvedValueOnce(replacement).mockResolvedValueOnce(undefined)
    const view = await render(<CanonicalSourceReader {...readerProps(read)} />)
    await fireEvent.press(view.getByRole('button', { name: 'source.refreshSavedSource' }))
    expect(view.getByText('New revision')).toBeTruthy()
    expect(view.getByText('source.citedSectionMissing')).toBeTruthy()
    expect(view.queryByText('source.savedCitedSection')).toBeNull()
    await fireEvent.press(view.getByRole('button', { name: 'source.refreshSavedSource' }))
    expect(view.getByText('source.savedSourceMissing')).toBeTruthy()
    expect(view.queryByText('New revision')).toBeNull()
    expect(view.getByText('Captured excerpt')).toBeTruthy()
  })

  it('does not misreport a read failure as deletion and supports retry', async () => {
    const read = jest.fn<ReturnType<Read>, Parameters<Read>>()
      .mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce(documentSource())
    const view = await render(<CanonicalSourceReader {...readerProps(read)} />)
    expect(view.getByText('source.savedSourceReadFailed')).toBeTruthy()
    expect(view.queryByText('source.savedSourceMissing')).toBeNull()
    expect(view.getByText('Captured excerpt')).toBeTruthy()
    await fireEvent.press(view.getByRole('button', { name: 'source.refreshSavedSource' }))
    expect(view.getByText(documentSource().chunks[1].content)).toBeTruthy()
  })

  it('does not resolve an unlinked citation by title, excerpt, URL, or ordinal', async () => {
    const read = jest.fn<ReturnType<Read>, Parameters<Read>>()
    const view = await render(<CanonicalSourceReader {...readerProps(read)} citation={{ ...citation, documentId: undefined }} />)
    expect(read).not.toHaveBeenCalled()
    expect(view.getByText('source.savedSourceUnlinked')).toBeTruthy()
    expect(view.getByText('Captured excerpt')).toBeTruthy()
  })

  it('cancels old reads and never displays a stale source after navigation or refresh', async () => {
    const first = deferred<KnowledgeLocalSource | undefined>()
    const second = deferred<KnowledgeLocalSource | undefined>()
    const refresh = deferred<KnowledgeLocalSource | undefined>()
    const read = jest.fn<ReturnType<Read>, Parameters<Read>>()
      .mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(refresh.promise)
    const props = readerProps(read)
    const view = await render(<CanonicalSourceReader {...props} />)
    const next = { ...props, citation: { ...citation, id: 'citation-b', documentId: 'document-b' } }
    await view.rerender(<CanonicalSourceReader {...next} />)
    expect(read.mock.calls[0][1]?.signal?.aborted).toBe(true)
    await act(async () => { first.resolve(documentSource()) })
    expect(view.queryByText(documentSource().chunks[1].content)).toBeNull()
    expect(view.getByLabelText('source.loadingSavedSource')).toBeTruthy()
    const source = documentSource()
    const current: KnowledgeLocalSource = { ...source, document: { ...source.document, id: 'document-b' },
      chunks: [{ ...source.chunks[1], documentId: 'document-b', content: 'Only the current source' }] }
    await act(async () => { second.resolve(current) })
    expect(view.getByText('Only the current source')).toBeTruthy()
    await fireEvent.press(view.getByRole('button', { name: 'source.refreshSavedSource' }))
    expect(view.queryByText('Only the current source')).toBeNull()
    await view.unmount()
    expect(read.mock.calls[2][1]?.signal?.aborted).toBe(true)
    await act(async () => { refresh.resolve(current) })
  })

  it('passes conversation scope for memory and displays its full content and disabled status', async () => {
    const read = jest.fn<ReturnType<Read>, Parameters<Read>>().mockResolvedValue({ type: 'memory', memory: {
      schema: 'islemind.knowledge-memory-record.v1', id: 'memory-a', content: 'Complete retained memory', status: 'disabled',
      scope: { kind: 'conversation', id: 'conversation-a' }, sensitivity: 'normal', sourceMessageIds: [],
      sourceKind: 'manual', createdAt: 1_000, updatedAt: 2_000,
    } })
    const view = await render(<CanonicalSourceReader {...readerProps(read)} citation={{ ...citation, id: 'memory-a', type: 'memory' }} />)
    expect(read.mock.calls[0][0]).toEqual({ type: 'memory', memoryId: 'memory-a', conversationId: 'conversation-a' })
    expect(view.getByText('Complete retained memory').props.selectable).toBe(true)
    expect(view.getByText('source.memoryStatus_disabled')).toBeTruthy()
  })
})

describe('SourceDetailScreen identity and URL boundaries', () => {
  const load = jest.fn(async () => undefined)
  let citations: MessageCitation[]
  beforeEach(() => {
    citations = [citation]
    load.mockClear()
    router.setParams.mockClear()
    WebView.mockClear()
    useLocalSearchParams.mockReturnValue({ conversationId: 'conversation-a', messageId: 'message-a', citationId: citation.id })
    useChatStore.mockImplementation((select: (state: unknown) => unknown) => select({ load,
      conversations: [{ id: 'conversation-a', messages: [{ id: 'message-a', timestamp: 1_500, status: 'done', citations }] }],
    }))
  })
  afterEach(() => jest.restoreAllMocks())

  it('never substitutes the first citation when the requested identity is missing', async () => {
    useLocalSearchParams.mockReturnValue({ conversationId: 'conversation-a', messageId: 'message-a', citationId: 'missing', url: 'https://example.test' })
    const read = jest.fn<ReturnType<Read>, Parameters<Read>>()
    const view = await render(<SourceDetailScreen readLocalSource={read} />)
    expect(view.getByText('source.noSource')).toBeTruthy()
    expect(view.queryByText(citation.excerpt!)).toBeNull()
    expect(read).not.toHaveBeenCalled()
    expect(WebView).not.toHaveBeenCalled()
  })

  it.each([true, false])('does not resolve an ambiguous citation ID to the first record (explicit=%s)', async (explicit) => {
    citations = [citation, { ...citation, title: 'Different source with the same ID', documentId: 'document-b' }]
    useLocalSearchParams.mockReturnValue({
      conversationId: 'conversation-a', messageId: 'message-a',
      ...(explicit ? { citationId: citation.id } : {}), url: 'https://example.test/override',
    })
    const read = jest.fn<ReturnType<Read>, Parameters<Read>>().mockResolvedValue(undefined)
    const view = await render(<SourceDetailScreen readLocalSource={read} />)
    expect(view.getByText('source.noSource')).toBeTruthy()
    expect(read).not.toHaveBeenCalled()
    expect(WebView).not.toHaveBeenCalled()
    expect(view.queryByText(citation.excerpt!)).toBeNull()
  })

  it('reads local retained text without opening its origin URL, even with a legacy URL parameter', async () => {
    citations = [{ ...citation, url: 'https://example.test/source' }]
    useLocalSearchParams.mockReturnValue({ conversationId: 'conversation-a', messageId: 'message-a', citationId: citation.id, url: citations[0].url })
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true)
    const read = jest.fn<ReturnType<Read>, Parameters<Read>>().mockResolvedValue(documentSource())
    const view = await render(<SourceDetailScreen readLocalSource={read} />)
    expect(view.getByText(documentSource().chunks[1].content)).toBeTruthy()
    expect(WebView).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
    await fireEvent.press(view.getByRole('button', { name: 'source.openOriginal' }))
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://example.test/source'))
  })

  it('does not offer unsafe original URLs to external apps', async () => {
    citations = [{ ...citation, url: 'https://example.test?token=sensitive', sourceUri: 'file:///private/source.txt' }]
    const view = await render(<SourceDetailScreen readLocalSource={async () => undefined} />)
    expect(view.queryByRole('button', { name: 'source.openOriginal' })).toBeNull()
    expect(WebView).not.toHaveBeenCalled()
  })

  it('preserves a web citation preview and the default selection when no citation ID was requested', async () => {
    citations = [{ id: 'web-citation', type: 'web', title: 'Web source', url: 'https://example.test/article' }]
    useLocalSearchParams.mockReturnValue({ conversationId: 'conversation-a', messageId: 'message-a' })
    const read = jest.fn<ReturnType<Read>, Parameters<Read>>()
    await render(<SourceDetailScreen readLocalSource={read} />)
    expect(WebView.mock.calls.at(-1)?.[0].source).toEqual({ uri: 'https://example.test/article' })
    expect(read).not.toHaveBeenCalled()
  })

  it('selects another citation by its explicit identity and clears an old URL override', async () => {
    citations = [citation, { ...citation, id: 'citation-b', title: 'Another source', documentId: 'document-b', excerpt: 'Another captured excerpt' }]
    const read = jest.fn<ReturnType<Read>, Parameters<Read>>().mockResolvedValue(undefined)
    const view = await render(<SourceDetailScreen readLocalSource={read} />)
    await fireEvent.press(view.getByRole('button', { name: '2. Another source' }))
    expect(router.setParams).toHaveBeenCalledWith({ citationId: 'citation-b', url: undefined })
    useLocalSearchParams.mockReturnValue({ conversationId: 'conversation-a', messageId: 'message-a', citationId: 'citation-b' })
    await view.rerender(<SourceDetailScreen readLocalSource={read} />)
    expect(read.mock.calls.at(-1)?.[0]).toEqual({ type: 'knowledge', documentId: 'document-b' })
    expect(view.getByText('Another captured excerpt')).toBeTruthy()
    expect(view.queryByText('Captured excerpt')).toBeNull()
  })
})
