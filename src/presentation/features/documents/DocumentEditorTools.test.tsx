import { render } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'
import { DocumentSaveStatus } from './DocumentEditorTools'

jest.mock('@/hooks/useAppTheme', () => ({
  useAppTheme: () => ({ colors: require('@/theme/colors').getColors('light', 'minimal') }),
}))
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('@/components/ui/isle', () => ({
  IslePressable: require('react-native').Pressable,
  IsleButton: () => null,
}))
jest.mock('moti', () => ({ MotiView: require('react-native').View }))
jest.mock('@/hooks/useThemeMotion', () => ({ useThemeMotion: () => ({ transition: {} }) }))

it.each(['saving', 'unsaved', 'saved'] as const)(
  'overlays the %s notice with the supported native absolute-fill style',
  async status => {
    const screen = await render(<DocumentSaveStatus status={status} />)
    const notice = screen.getByTestId('document-save-status')
    expect(notice).toHaveStyle({ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 })
    expect(notice.props.accessibilityLiveRegion).toBe('polite')
    expect(screen.getAllByText(`documents.${status}`)).toHaveLength(1)
    expect(screen.getAllByText('documents.unsaved', { includeHiddenElements: true }))
      .toHaveLength(status === 'unsaved' ? 2 : 1)
  },
)

it('keeps the reserved status slot stable and fluid across save-state changes', async () => {
  const screen = await render(<DocumentSaveStatus status="unsaved" />)
  const slot = screen.getByTestId('document-save-status-slot')
  const notice = screen.getByTestId('document-save-status')

  for (const status of ['saving', 'saved', 'unsaved'] as const) {
    await screen.rerender(<DocumentSaveStatus status={status} />)
    expect(screen.getByTestId('document-save-status-slot')).toBe(slot)
    expect(screen.getByTestId('document-save-status')).toBe(notice)
    expect(StyleSheet.flatten(slot.props.style).height).toBeUndefined()
    expect(screen.getAllByText(`documents.${status}`)).toHaveLength(1)
  }
})
