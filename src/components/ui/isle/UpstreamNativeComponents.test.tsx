import { useState } from 'react'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { Avatar, Badge, Calendar, CountUp, Rate, Upload, useTheme } from 'animal-island-ui-rn'
import { Text } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'
import { getColors } from '@/theme/colors'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'
import {
  IsleAvatar, IsleAvatarGroup, IsleBadge, IsleCalendar, IsleCountUp, IsleRate, IsleUpload,
  type IsleUploadCustomRequestOptions, type IsleUploadNativeFile,
} from './index'
import { IsleThemeProvider } from './IsleThemeProvider'

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: { fine: 1.5, regular: 1.75, strong: 2 } }))

const selectedFile: IsleUploadNativeFile = { uri: 'file:///host-owned/picture.png', name: 'picture.png', type: 'image/png', size: 1024 }

function setTheme(id: CanonicalThemeId, mode: 'light' | 'dark') {
  const colors = getColors(mode, id)
  jest.mocked(useAppTheme).mockReturnValue({
    colors, design: colors.design!, canonicalThemeId: id, mode, themeMode: mode,
    isDark: mode === 'dark', isMinimal: id === 'minimal', isMonet: id === 'monet',
    isMaterial: id === 'material', isLiquidGlass: id === 'liquid-glass', isAnimalIsland: id === 'animal-island-ui',
  } as ReturnType<typeof useAppTheme>)
}

beforeEach(() => setTheme('animal-island-ui', 'light'))

it('exposes exactly the library implementations and native types without duplicate app ports', () => {
  expect([IsleAvatar, IsleBadge, IsleCalendar, IsleCountUp, IsleRate, IsleUpload])
    .toEqual([Avatar, Badge, Calendar, CountUp, Rate, Upload])
  expect(IsleAvatarGroup).toBe(Avatar.Group)
})

it.each(CANONICAL_THEME_IDS.flatMap(id => (['light', 'dark'] as const).map(mode => ({ id, mode }))))(
  'composes new native components under the $id $mode host bridge without initiating effects',
  async ({ id, mode }) => {
    setTheme(id, mode)
    function Probe() {
      const value = useTheme()
      return <Text>{`bridge:${value.mode}:${value.reducedMotion}`}</Text>
    }
    const changed = jest.fn(), completed = jest.fn()
    const view = await render(<IsleThemeProvider>
      <Probe />
      <IsleAvatar alt="Profile" size="small">IM</IsleAvatar>
      <IsleBadge count={120} title="120 pending" />
      <IsleCalendar defaultValue="2026-10-05" width={320} onChange={changed} />
      <IsleCountUp start={10} end={20} onComplete={completed} />
      <IsleRate readonly value={3} accessibilityLabel="Quality" />
      <IsleUpload accessibilityLabel="Select attachment" />
    </IsleThemeProvider>)
    expect(view.getByText(`bridge:${mode}:true`)).toBeTruthy()
    expect(view.getByRole('image', { name: 'Profile' })).toBeTruthy()
    expect(view.getByLabelText('120 pending')).toBeTruthy()
    expect(view.getByRole('image', { name: 'Quality' }).props.accessibilityValue.now).toBe(3)
    expect(view.getByRole('button', { name: 'Select attachment' }).props.accessibilityState.disabled).toBe(true)
    expect(changed).not.toHaveBeenCalled()
    expect(completed).not.toHaveBeenCalled()
  }
)

it('requires actual host writeback for Calendar and Rate selections', async () => {
  function Owner() {
    const [date, setDate] = useState('2026-10-05')
    const [rating, setRating] = useState(1)
    return <>
      <IsleCalendar value={date} onChange={setDate} testID="calendar" />
      <IsleRate value={rating} onChange={setRating} />
    </>
  }
  const view = await render(<IsleThemeProvider><Owner /></IsleThemeProvider>)
  await fireEvent.press(view.getByTestId('calendar-day-2026-10-06'))
  expect(view.getByTestId('calendar-day-2026-10-06').props.accessibilityState.selected).toBe(true)
  await fireEvent.press(view.getByRole('radio', { name: '4 stars' }))
  expect(view.getByRole('radio', { name: '4 stars' }).props.accessibilityState.checked).toBe(true)
})

it('does not report a selected attachment as uploaded when the host supplies no transport', async () => {
  const view = await render(<IsleThemeProvider>
    <IsleUpload onPickFiles={() => [selectedFile]} />
  </IsleThemeProvider>)
  await fireEvent.press(view.getByRole('button', { name: 'Upload files' }))
  await waitFor(() => expect(view.getByText('1.0 KB Upload failed')).toBeTruthy())
  expect(view.queryByText('1.0 KB Uploaded')).toBeNull()
})

it('aborts the supplied host transport on unmount and fences late completion without deleting its URI', async () => {
  let request: IsleUploadCustomRequestOptions | undefined
  const changed = jest.fn(), aborted = jest.fn()
  const view = await render(<IsleThemeProvider>
    <IsleUpload onPickFiles={() => [selectedFile]} onChange={changed}
      customRequest={options => { request = options; return { abort: aborted } }} />
  </IsleThemeProvider>)
  await fireEvent.press(view.getByRole('button', { name: 'Upload files' }))
  await waitFor(() => expect(request).toBeDefined())
  const count = changed.mock.calls.length
  await view.unmount()
  expect(request!.signal.aborted).toBe(true)
  expect(aborted).toHaveBeenCalledTimes(1)
  await act(() => request!.onSuccess({ id: 'late' }))
  expect(changed).toHaveBeenCalledTimes(count)
  expect(selectedFile.uri).toBe('file:///host-owned/picture.png')
})
