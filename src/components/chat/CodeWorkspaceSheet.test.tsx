import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { CodeWorkspaceSheet } from './CodeWorkspaceSheet'

let mockMotion: 'full' | 'reduced' | 'none' = 'none'
let mockAnimationType: string
const mockQueryFiles = jest.fn()
jest.mock('react-native/Libraries/Modal/Modal', () => ({ __esModule: true, default: ({ animationType, children }: { animationType: string; children: React.ReactNode }) => {
  mockAnimationType = animationType
  return children
} }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: require('@/theme/colors').getColors('light', 'minimal') }) }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => mockMotion }))
jest.mock('@/bootstrap/builtInWorkspaceFileRuntime', () => ({ builtInWritableWorkspaceFilePort: { queryFiles: (...args: unknown[]) => mockQueryFiles(...args) } }))
jest.mock('@/components/ui/isle', () => {
  const { Pressable, Text } = require('react-native')
  return { IsleButton: ({ label, ...props }: { label: string }) => <Pressable accessibilityRole="button" accessibilityLabel={label} {...props}><Text>{label}</Text></Pressable> }
})

beforeEach(() => {
  jest.clearAllMocks()
  mockQueryFiles.mockResolvedValue({ files: [{ relativePath: 'workspace/qa.txt' }] })
})

it.each(['full', 'reduced', 'none'] as const)('respects %s motion while selecting only a local path', async motion => {
  mockMotion = motion
  const onInsertPath = jest.fn()
  const view = await render(<CodeWorkspaceSheet onClose={jest.fn()} onInsertPath={onInsertPath} />)
  expect(mockAnimationType).toBe(motion === 'full' ? 'fade' : 'none')
  const path = await view.findByRole('button', { name: 'workspace/qa.txt' })
  expect(mockQueryFiles).toHaveBeenCalledWith({ directory: 'workspace', limit: 20, afterPath: undefined }, { signal: expect.any(AbortSignal) })
  await fireEvent.press(path)
  expect(onInsertPath).toHaveBeenCalledWith('workspace/qa.txt')
  expect(mockQueryFiles).toHaveBeenCalledTimes(1)
})

it('keeps a failed listing visible and recovers through explicit refresh', async () => {
  mockQueryFiles.mockRejectedValueOnce(new Error('Local fixture read failure'))
  const view = await render(<CodeWorkspaceSheet onClose={jest.fn()} onInsertPath={jest.fn()} />)
  await waitFor(() => expect(view.getByRole('alert')).toBeTruthy())
  await fireEvent.press(view.getByRole('button', { name: 'common.refresh' }))
  expect(await view.findByRole('button', { name: 'workspace/qa.txt' })).toBeTruthy()
  expect(view.queryByRole('alert')).toBeNull()
  expect(mockQueryFiles).toHaveBeenCalledTimes(2)
})
