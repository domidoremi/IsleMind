import type { ReactNode } from 'react'
import { Linking, Platform, Text } from 'react-native'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import * as Clipboard from 'expo-clipboard'
import type { KnowledgeLocalSource, KnowledgeLocalSourceReader } from '@/modules/knowledge'
import type { MessageCitation } from '@/types/contextContracts'
import { createProviderCitationSupportBinder } from '@/core'
import { CanonicalSourceReader, type CanonicalSourceReaderProps } from './CanonicalSourceReader'
import SourceDetailScreen from './SourceDetailScreen'

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }))
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
    useIsleDialog: jest.fn(() => ({ toast: jest.fn() })),
  }
})
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('@/components/ui/RenderGuard', () => ({ RenderGuard: ({ children }: { children: ReactNode }) => children }))
jest.mock('@/presentation/app-shell/ThemeDetailFrame', () => ({
  ThemeDetailFrame: jest.fn(({ children, actions }: { children: ReactNode; actions: ReactNode }) => <>{actions}{children}</>),
}))
jest.mock('@/store/chatStore', () => ({ useChatStore: jest.fn() }))
jest.mock('@/components/chat/tracePresentation', () => ({ collectVisibleProcessTraces: () => [], normalizeTraceStatuses: () => [] }))
jest.mock('react-native-webview', () => ({ WebView: jest.fn(() => null) }))

const { useLocalSearchParams, router } = jest.requireMock('expo-router')
const { useChatStore } = jest.requireMock('@/store/chatStore')
const { WebView } = jest.requireMock('react-native-webview')
const { ThemeDetailFrame } = jest.requireMock('@/presentation/app-shell/ThemeDetailFrame')
const { useIsleDialog } = jest.requireMock('@/components/ui/isle')
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
  const toast = jest.fn()
  let citations: MessageCitation[]
  let content: string
  let responseText: string | undefined
  beforeEach(() => {
    citations = [citation]
    content = 'Current answer 日本語 😀'
    responseText = undefined
    jest.clearAllMocks()
    useIsleDialog.mockReturnValue({ toast })
    useLocalSearchParams.mockReturnValue({ conversationId: 'conversation-a', messageId: 'message-a', citationId: citation.id })
    useChatStore.mockImplementation((select: (state: unknown) => unknown) => select({ load,
      conversations: [{ id: 'conversation-a', messages: [{ id: 'message-a', timestamp: 1_500, status: 'done', content, responseText, citations }] }],
    }))
  })
  afterEach(() => jest.restoreAllMocks())

  it.each(['success', 'false', 'rejection'] as const)('reports the actual source clipboard outcome: %s', async (outcome) => {
    const write = jest.mocked(Clipboard.setStringAsync)
    if (outcome === 'rejection') write.mockRejectedValueOnce(new Error('Clipboard unavailable'))
    else write.mockResolvedValueOnce(outcome === 'success')
    const read = jest.fn<ReturnType<Read>, Parameters<Read>>().mockResolvedValue(documentSource())
    const view = await render(<SourceDetailScreen readLocalSource={read} />)
    await fireEvent.press(view.getByRole('button', { name: 'common.copy' }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: outcome === 'success' ? 'common.copied' : 'common.copyFailed',
      tone: outcome === 'success' ? 'mint' : 'danger',
    })))
    expect(write).toHaveBeenCalledWith('Cited document\n\nCaptured excerpt')
    expect(toast).toHaveBeenCalledTimes(1)
  })

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

  it.each(['ios', 'android'] as const)('preserves a web citation preview and default selection on %s', async (platform) => {
    jest.replaceProperty(Platform, 'OS', platform)
    citations = [{ id: 'web-citation', type: 'web', title: 'Web source', url: 'https://example.test/article' }]
    useLocalSearchParams.mockReturnValue({ conversationId: 'conversation-a', messageId: 'message-a' })
    const read = jest.fn<ReturnType<Read>, Parameters<Read>>()
    const view = await render(<SourceDetailScreen readLocalSource={read} />)
    expect(WebView.mock.calls.at(-1)?.[0].source).toEqual({ uri: 'https://example.test/article' })
    expect(read).not.toHaveBeenCalled()
    expect(view.getByText('source.loadingPreview')).toBeTruthy()
    expect(ThemeDetailFrame.mock.calls.at(-1)?.[0].backgroundState).toBe('active')
    expect(view.queryByText('source.previewUnsupportedWebMessage')).toBeNull()
    const props = WebView.mock.calls.at(-1)?.[0]
    expect(props.originWhitelist).toEqual(['https://example.test'])
    expect(props.onShouldStartLoadWithRequest({ url: 'https://example.test/next' })).toBe(true)
    expect(props.onShouldStartLoadWithRequest({ url: 'http://example.test/next' })).toBe(false)
    expect(props.onShouldStartLoadWithRequest({ url: 'https://another.test/article' })).toBe(false)
    expect(props.setSupportMultipleWindows).toBe(false)
    await act(async () => { props.onLoadEnd() })
    expect(view.queryByText('source.loadingPreview')).toBeNull()
    expect(ThemeDetailFrame.mock.calls.at(-1)?.[0].backgroundState).toBe('idle')
    await fireEvent.press(view.getByRole('button', { name: 'common.refresh' }))
    expect(view.getByText('source.loadingPreview')).toBeTruthy()
    expect(ThemeDetailFrame.mock.calls.at(-1)?.[0].backgroundState).toBe('active')
  })

  it.each(['onError', 'onHttpError'])('preserves native preview failure and retry after %s', async (event) => {
    jest.replaceProperty(Platform, 'OS', 'android')
    citations = [{ ...citation, type: 'web', url: 'https://example.test/article' }]
    const view = await render(<SourceDetailScreen readLocalSource={async () => undefined} />)
    await act(async () => { WebView.mock.calls.at(-1)?.[0][event]() })
    expect(view.getByText('source.previewUnavailableMessage')).toBeTruthy()
    expect(view.queryByText('source.previewUnsupportedWebMessage')).toBeNull()
    expect(view.queryByText('source.loadingPreview')).toBeNull()
    expect(ThemeDetailFrame.mock.calls.at(-1)?.[0].backgroundState).toBe('error')
    expect(view.getByRole('button', { name: 'source.openInBrowser' })).toBeTruthy()
    await fireEvent.press(view.getByRole('button', { name: 'common.refresh' }))
    expect(view.queryByText('source.previewUnavailableMessage')).toBeNull()
    expect(view.getByText('source.loadingPreview')).toBeTruthy()
    expect(ThemeDetailFrame.mock.calls.at(-1)?.[0].backgroundState).toBe('active')
  })

  describe.each(['ios', 'android'] as const)('%s native preview attempt isolation', (platform) => {
    const firstUrl = 'https://first.example.test/article'
    const secondUrl = 'https://second.example.test/article'
    const read = jest.fn<ReturnType<Read>, Parameters<Read>>()
    const params = { conversationId: 'conversation-a', messageId: 'message-a', citationId: 'web-a' }

    beforeEach(() => {
      jest.replaceProperty(Platform, 'OS', platform)
      citations = [
        { id: 'web-a', type: 'web', title: 'First source', url: firstUrl },
        { id: 'web-b', type: 'web', title: 'Second source', url: secondUrl },
      ]
      useLocalSearchParams.mockReturnValue(params)
    })

    async function selectSource(view: Awaited<ReturnType<typeof render>>, second: boolean) {
      await fireEvent.press(view.getByRole('button', { name: second ? '2. Second source' : '1. First source' }))
      const citationId = second ? 'web-b' : 'web-a'
      expect(router.setParams).toHaveBeenLastCalledWith({ citationId, url: undefined })
      useLocalSearchParams.mockReturnValue({ ...params, citationId })
      await view.rerender(<SourceDetailScreen readLocalSource={read} />)
    }

    function expectLoading(view: Awaited<ReturnType<typeof render>>, url: string) {
      expect(WebView.mock.calls.at(-1)?.[0].source).toEqual({ uri: url })
      expect(view.getByText('source.loadingPreview')).toBeTruthy()
      expect(view.queryByText('source.previewUnavailableMessage')).toBeNull()
      expect(ThemeDetailFrame.mock.calls.at(-1)?.[0].backgroundState).toBe('active')
    }

    it.each(['onLoadEnd', 'onError', 'onHttpError'])('starts a fresh preview after the previous source reports %s', async (event) => {
      const view = await render(<SourceDetailScreen readLocalSource={read} />)
      await act(async () => { WebView.mock.calls.at(-1)?.[0][event]() })
      await selectSource(view, true)
      expectLoading(view, secondUrl)
      const current = WebView.mock.calls.at(-1)?.[0]
      expect(current.originWhitelist).toEqual(['https://second.example.test'])
      expect(current.onShouldStartLoadWithRequest({ url: firstUrl })).toBe(false)
      expect(current.onShouldStartLoadWithRequest({ url: 'http://second.example.test/article' })).toBe(false)
      expect(current.onShouldStartLoadWithRequest({ url: 'https://second.example.test/next' })).toBe(true)
      await act(async () => { current.onLoadEnd() })
      expect(view.queryByText('source.loadingPreview')).toBeNull()
      expect(ThemeDetailFrame.mock.calls.at(-1)?.[0].backgroundState).toBe('idle')
      expect(read).not.toHaveBeenCalled()
    })

    it.each(['onLoadEnd', 'onError', 'onHttpError'])('ignores obsolete %s callbacks, even after returning to the same URL', async (event) => {
      const view = await render(<SourceDetailScreen readLocalSource={read} />)
      const obsolete = WebView.mock.calls.at(-1)?.[0]
      await selectSource(view, true)
      const current = WebView.mock.calls.at(-1)?.[0]
      await act(async () => { obsolete[event]() })
      expectLoading(view, secondUrl)
      await act(async () => { current.onLoadEnd() })
      await act(async () => { obsolete[event]() })
      expect(view.queryByText('source.previewUnavailableMessage')).toBeNull()
      expect(ThemeDetailFrame.mock.calls.at(-1)?.[0].backgroundState).toBe('idle')
      await selectSource(view, false)
      await act(async () => { obsolete[event]() })
      expectLoading(view, firstUrl)
    })

    it.each(['citation', 'message', 'conversation', 'url'])('does not reuse failure state when only %s identity changes', async (identity) => {
      citations = citations.map((item) => ({ ...item, url: firstUrl }))
      const view = await render(<SourceDetailScreen readLocalSource={read} />)
      await act(async () => { WebView.mock.calls.at(-1)?.[0].onError() })
      const nextParams = { ...params }
      if (identity === 'citation') nextParams.citationId = 'web-b'
      if (identity === 'message') nextParams.messageId = 'message-b'
      if (identity === 'conversation') nextParams.conversationId = 'conversation-b'
      if (identity === 'url') citations = citations.map((item) => ({ ...item, url: secondUrl }))
      useChatStore.mockImplementation((select: (state: unknown) => unknown) => select({ load,
        conversations: [{ id: nextParams.conversationId, messages: [{
          id: nextParams.messageId, timestamp: 1_500, status: 'done', content, citations,
        }] }],
      }))
      useLocalSearchParams.mockReturnValue(nextParams)
      await view.rerender(<SourceDetailScreen readLocalSource={read} />)
      expectLoading(view, identity === 'url' ? secondUrl : firstUrl)
    })

    it('keeps Refresh attempt-scoped and ignores the previous attempt callbacks', async () => {
      const view = await render(<SourceDetailScreen readLocalSource={read} />)
      const obsolete = WebView.mock.calls.at(-1)?.[0]
      await act(async () => { obsolete.onError() })
      await fireEvent.press(view.getByRole('button', { name: 'common.refresh' }))
      await act(async () => { obsolete.onLoadEnd(); obsolete.onHttpError() })
      expectLoading(view, firstUrl)
    })

    it('does not restart an unchanged preview for answer, title, excerpt or metadata updates', async () => {
      const view = await render(<SourceDetailScreen readLocalSource={read} />)
      await act(async () => { WebView.mock.calls.at(-1)?.[0].onLoadEnd() })
      content = 'Updated answer'
      const providerSupport = createProviderCitationSupportBinder(content)([{ text: content, partIndex: 0, startByte: 0, endByte: 14 }])
      citations = citations.map((item) => ({ ...item, title: 'Updated source title', excerpt: 'New captured excerpt', providerSupport }))
      await view.rerender(<SourceDetailScreen readLocalSource={read} />)
      expect(view.getByText('New captured excerpt')).toBeTruthy()
      expect(view.queryByText('source.loadingPreview')).toBeNull()
      expect(ThemeDetailFrame.mock.calls.at(-1)?.[0].backgroundState).toBe('idle')
    })

    it('isolates legacy URL-only previews when their target changes', async () => {
      useLocalSearchParams.mockReturnValue({ url: firstUrl })
      const view = await render(<SourceDetailScreen readLocalSource={read} />)
      await act(async () => { WebView.mock.calls.at(-1)?.[0].onError() })
      useLocalSearchParams.mockReturnValue({ url: secondUrl })
      await view.rerender(<SourceDetailScreen readLocalSource={read} />)
      expectLoading(view, secondUrl)
    })
  })

  it('does not leave unsupported Web previews loading or open the source without an explicit action', async () => {
    jest.replaceProperty(Platform, 'OS', 'web')
    citations = [{ ...citation, type: 'web', url: 'https://example.test/article' }]
    const read = jest.fn<ReturnType<Read>, Parameters<Read>>()
    const canOpen = jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true)
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
    const view = await render(<SourceDetailScreen readLocalSource={read} />)
    expect(view.getByText('source.previewUnsupportedWebMessage')).toBeTruthy()
    expect(view.getByText('Captured excerpt')).toBeTruthy()
    expect(view.queryByText('source.previewUnavailableMessage')).toBeNull()
    expect(view.queryByText('source.loadingPreview')).toBeNull()
    expect(view.queryByRole('button', { name: 'common.refresh' })).toBeNull()
    expect(ThemeDetailFrame.mock.calls.every(([props]: [{ backgroundState: string }]) => props.backgroundState === 'idle')).toBe(true)
    expect(WebView).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
    expect(canOpen).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
    await fireEvent.press(view.getByRole('button', { name: 'source.openInBrowser' }))
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://example.test/article'))
    await fireEvent.press(view.getByRole('button', { name: 'source.openOriginal' }))
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2))
    expect(toast).not.toHaveBeenCalled()
  })

  it.each([
    'javascript:alert(1)', 'file:///private/source.txt',
    'https://user:password@example.test/article', 'https://example.test/article?access_token=synthetic',
  ])('does not offer a Web fallback for an unsafe URL: %s', async (url) => {
    jest.replaceProperty(Platform, 'OS', 'web')
    citations = [{ ...citation, type: 'web', url, sourceUri: url }]
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
    const view = await render(<SourceDetailScreen readLocalSource={async () => undefined} />)
    expect(view.queryByRole('button', { name: 'source.openOriginal' })).toBeNull()
    expect(view.queryByRole('button', { name: 'source.openInBrowser' })).toBeNull()
    expect(view.queryByText('source.loadingPreview')).toBeNull()
    expect(WebView).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })

  it.each(['unsupported', 'capability-rejected', 'open-rejected'])('reports external-open failure without an unhandled rejection: %s', async (failure) => {
    jest.replaceProperty(Platform, 'OS', 'web')
    citations = [{ ...citation, type: 'web', url: 'https://example.test/article' }]
    const canOpen = jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(failure !== 'unsupported')
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
    if (failure === 'capability-rejected') canOpen.mockRejectedValue(new Error('Synthetic capability failure'))
    if (failure === 'open-rejected') open.mockRejectedValue(new Error('Synthetic launch failure'))
    const view = await render(<SourceDetailScreen readLocalSource={async () => undefined} />)
    await fireEvent.press(view.getByRole('button', { name: 'source.openInBrowser' }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith({
      title: 'source.cannotOpen', message: 'source.cannotOpenMessage', tone: 'danger',
    }))
    expect(open).toHaveBeenCalledTimes(failure === 'open-rejected' ? 1 : 0)
    expect(view.getByText('source.previewUnsupportedWebMessage')).toBeTruthy()
  })

  it('keeps the Web fallback scoped to the selected source and preserves the local reader', async () => {
    jest.replaceProperty(Platform, 'OS', 'web')
    citations = [
      { ...citation, type: 'web', url: 'https://example.test/first' },
      { ...citation, id: 'web-b', type: 'web', title: 'Second source', url: 'https://example.test/second' },
      { ...citation, id: 'local-c', title: 'Local source', url: 'https://example.test/origin' },
    ]
    const read = jest.fn<ReturnType<Read>, Parameters<Read>>().mockResolvedValue(documentSource())
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true)
    const view = await render(<SourceDetailScreen readLocalSource={read} />)
    await fireEvent.press(view.getByRole('button', { name: '2. Second source' }))
    expect(router.setParams).toHaveBeenCalledWith({ citationId: 'web-b', url: undefined })
    useLocalSearchParams.mockReturnValue({ conversationId: 'conversation-a', messageId: 'message-a', citationId: 'web-b' })
    await view.rerender(<SourceDetailScreen readLocalSource={read} />)
    await fireEvent.press(view.getByRole('button', { name: 'source.openInBrowser' }))
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://example.test/second'))
    expect(open).toHaveBeenCalledTimes(1)
    expect(read).not.toHaveBeenCalled()
    useLocalSearchParams.mockReturnValue({ conversationId: 'conversation-a', messageId: 'message-a', citationId: 'local-c' })
    await view.rerender(<SourceDetailScreen readLocalSource={read} />)
    expect(view.getByText(documentSource().chunks[1].content)).toBeTruthy()
    expect(view.queryByText('source.previewUnsupportedWebMessage')).toBeNull()
    expect(view.queryByRole('button', { name: 'source.openInBrowser' })).toBeNull()
    expect(WebView).not.toHaveBeenCalled()
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

  it.each(['ios', 'web'] as const)('shows plain selectable provider passages on %s, not numbered bindings or source-read authority', async (platform) => {
    jest.replaceProperty(Platform, 'OS', platform)
    const text = '日本語 😀'
    responseText = content
    const providerSupport = createProviderCitationSupportBinder(responseText)([{ text, partIndex: 2, startByte: 8, endByte: 22 }])!
    content = 'A different legacy content field'
    citations = [{ id: 'web', type: 'web', title: 'Web source', url: 'https://example.test/article', providerSupport }]
    useLocalSearchParams.mockReturnValue({ conversationId: 'conversation-a', messageId: 'message-a', citationId: 'web' })
    const read = jest.fn<ReturnType<Read>, Parameters<Read>>()
    const view = await render(<SourceDetailScreen readLocalSource={read} />)
    expect(view.getByText('source.providerPassagesNotice')).toBeTruthy()
    expect(view.queryByText('source.providerPassagesHistorical')).toBeNull()
    expect(view.queryByText(text)).toBeNull()
    await fireEvent.press(view.getByRole('button', { name: 'source.showProviderPassages' }))
    expect(view.getByText(text).props.selectable).toBe(true)
    expect(view.getByText('source.providerPassagesRangeNotice')).toBeTruthy()
    expect(read).not.toHaveBeenCalled()
    responseText += ' '
    await view.rerender(<SourceDetailScreen readLocalSource={read} />)
    expect(view.getByText('source.providerPassagesHistorical')).toBeTruthy()
    expect(view.getByText(text)).toBeTruthy()
  })

  it.each([undefined, { schema: 'unknown' }])('does not infer associations from source order, excerpts or malformed metadata: %j', async (providerSupport) => {
    citations = [{ id: 'web', type: 'web', title: 'Source [1]', excerpt: content, providerSupport } as MessageCitation]
    useLocalSearchParams.mockReturnValue({ conversationId: 'conversation-a', messageId: 'message-a', citationId: 'web' })
    const view = await render(<SourceDetailScreen readLocalSource={async () => undefined} />)
    expect(view.getByText('source.providerPassagesUnknown')).toBeTruthy()
    expect(view.queryByRole('button', { name: 'source.showProviderPassages' })).toBeNull()
    expect(view.queryByText('source.providerPassagesNotice')).toBeNull()
  })

  it('does not display support from an ambiguous ID or carry the old panel to another source', async () => {
    const providerSupport = createProviderCitationSupportBinder(content)([{ text: '日本語 😀', partIndex: 0, startByte: 0, endByte: 14 }])!
    const web: MessageCitation = { id: 'web', type: 'web', title: 'Web source', providerSupport }
    citations = [web, { ...web, title: 'Different source' }]
    useLocalSearchParams.mockReturnValue({ conversationId: 'conversation-a', messageId: 'message-a', citationId: 'web' })
    const view = await render(<SourceDetailScreen readLocalSource={async () => undefined} />)
    expect(view.queryByText('source.providerPassagesNotice')).toBeNull()
    citations = [web, { ...web, id: 'web-b', providerSupport: undefined }]
    await view.rerender(<SourceDetailScreen readLocalSource={async () => undefined} />)
    await fireEvent.press(view.getByRole('button', { name: 'source.showProviderPassages' }))
    expect(view.getByText('日本語 😀')).toBeTruthy()
    useLocalSearchParams.mockReturnValue({ conversationId: 'conversation-a', messageId: 'message-a', citationId: 'web-b' })
    await view.rerender(<SourceDetailScreen readLocalSource={async () => undefined} />)
    expect(view.queryByText('日本語 😀')).toBeNull()
    expect(view.getByText('source.providerPassagesUnknown')).toBeTruthy()
  })
})
