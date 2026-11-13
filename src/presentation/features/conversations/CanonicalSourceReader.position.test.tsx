import type { ComponentProps } from 'react'
import { FlatList, Text, View } from 'react-native'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import type { KnowledgeLocalSource, KnowledgeLocalSourceReader } from '@/modules/knowledge'
import { CanonicalSourceReader } from './CanonicalSourceReader'
import { useSourceReadingSession } from './useSourceReadingSession'

jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, [effect]),
}))
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
jest.mock('@/hooks/useAppTheme', () => ({
  useAppTheme: () => ({ colors: jest.requireActual('@/theme/colors').getColors('light', 'minimal') }),
}))
jest.mock('@/components/ui/isle', () => {
  const native = jest.requireActual('react-native')
  return {
    IsleButton: ({ label, onPress }: { label: string; onPress: () => void }) =>
      <native.Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
        <native.Text>{label}</native.Text>
      </native.Pressable>,
    IsleChip: native.Text,
    IslePressable: native.Pressable,
  }
})
jest.mock('@/presentation/layout/useWorkspaceLayout', () => ({ useWorkspaceLayout: () => ({ wide: false }) }))
jest.mock('@/presentation/layout/WorkspaceSurface', () => {
  const native = jest.requireActual('react-native')
  return { WorkspaceSurface: ({ children, ...props }: ComponentProps<typeof View>) =>
    <native.View {...props}>{children}</native.View> }
})

type Read = KnowledgeLocalSourceReader['readLocalSource']
function savedSource(updatedAt = 2_000): Extract<KnowledgeLocalSource, { type: 'knowledge' }> {
  return {
    type: 'knowledge',
    document: { schema: 'islemind.knowledge-document-record.v1', id: 'saved-document',
      title: 'Retained source', mimeType: 'text/plain', size: 2_000, chunkCount: 2,
      status: 'ready', createdAt: 1_000, updatedAt },
    chunks: [0, 1].map(ordinal => ({
      schema: 'islemind.knowledge-chunk-record.v1', id: 'saved-section-' + ordinal,
      documentId: 'saved-document', title: 'Retained source', ordinal,
      content: 'Saved section ' + ordinal + ' 日本語 😀', createdAt: 1_000,
    })),
  }
}
function Reader({ read }: { read: Read }) {
  const { session } = useSourceReadingSession('open-source-route')
  return <CanonicalSourceReader conversationId="saved-conversation" messageId="saved-message"
    messageTimestamp={1_500} citation={{ id: 'saved-citation', type: 'knowledge', title: 'Retained source',
      documentId: 'saved-document', chunkId: 'saved-section-1' }}
    readLocalSource={read} header={<Text>Captured source text</Text>} reading={session} />
}
const scroll = (y: number) => ({ nativeEvent: {
  contentOffset: { x: 0, y }, contentSize: { width: 320, height: 2_000 },
  layoutMeasurement: { width: 320, height: 400 },
} })
async function measure(view: Awaited<ReturnType<typeof render>>) {
  await act(async () => {
    fireEvent(view.getByTestId('canonical-source-reader'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 400 } },
    })
    fireEvent(view.getByTestId('canonical-source-reader'), 'contentSizeChange', 320, 2_000)
  })
}

it('keeps measured positions separate for cited and all sections, including a late hidden-list scroll', async () => {
  const move = jest.spyOn(FlatList.prototype, 'scrollToOffset').mockImplementation(() => {})
  const read = jest.fn<ReturnType<Read>, Parameters<Read>>().mockResolvedValue(savedSource())
  try {
    const view = await render(<Reader read={read} />)
    await waitFor(() => expect(view.getByText('Saved section 1 日本語 😀')).toBeTruthy())
    await measure(view)
    await fireEvent.scroll(view.getByTestId('canonical-source-reader'), scroll(600))
    const previousScroll = view.getByTestId('canonical-source-reader').props.onScroll
    await fireEvent.press(view.getByRole('button', { name: 'source.showAllSavedSections' }))
    await measure(view)
    await fireEvent.scroll(view.getByTestId('canonical-source-reader'), scroll(900))
    await act(() => previousScroll(scroll(1_400)))
    move.mockClear()
    await fireEvent.press(view.getByRole('button', { name: 'source.showCitedSection' }))
    await measure(view)
    expect(move).toHaveBeenCalledWith({ offset: 600, animated: false })
    expect(view.queryByText('Saved section 0 日本語 😀')).toBeNull()
    move.mockClear()
    await fireEvent.press(view.getByRole('button', { name: 'source.showAllSavedSections' }))
    await measure(view)
    expect(move).toHaveBeenCalledWith({ offset: 900, animated: false })
    expect(read).toHaveBeenCalledTimes(1)
    await view.unmount()
  } finally {
    move.mockRestore()
  }
})

it('starts an explicitly refreshed saved revision at the beginning without restoring the old revision offset', async () => {
  const move = jest.spyOn(FlatList.prototype, 'scrollToOffset').mockImplementation(() => {})
  const read = jest.fn<ReturnType<Read>, Parameters<Read>>()
    .mockResolvedValueOnce(savedSource()).mockResolvedValueOnce(savedSource(3_000))
  try {
    const view = await render(<Reader read={read} />)
    await waitFor(() => expect(view.getByText('Saved section 1 日本語 😀')).toBeTruthy())
    await measure(view)
    await fireEvent.scroll(view.getByTestId('canonical-source-reader'), scroll(600))
    move.mockClear()
    await fireEvent.press(view.getByRole('button', { name: 'source.refreshSavedSource' }))
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    await measure(view)
    expect(move).toHaveBeenCalledWith({ offset: 0, animated: false })
    expect(move).not.toHaveBeenCalledWith({ offset: 600, animated: false })
    await view.unmount()
  } finally {
    move.mockRestore()
  }
})
