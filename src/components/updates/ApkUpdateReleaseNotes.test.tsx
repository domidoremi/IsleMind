import { fireEvent, render, within } from '@testing-library/react-native'
import { Linking } from 'react-native'
import { useSettingsStore } from '@/store/settingsStore'
import type { ApkReleaseInfo } from '@/platform/native/androidApkUpdates'
import { ApkUpdateReleaseNotes } from './useApkUpdatePrompt'

const mockToast = jest.fn()
const mockEnglish = require('@/i18n/resources/en.json')
const mockTranslate = (key: string, options: Record<string, unknown> = {}) => {
  const text = key.split('.').reduce((value, part) => value?.[part], mockEnglish)
  return typeof text === 'string' ? text.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(options[name] ?? '')) : key
}
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: { text: '#111', textSecondary: '#555', primary: '#007' } }) }))
jest.mock('@/components/ui/isle', () => ({
  useIsleDialog: () => ({ toast: mockToast }),
  IsleButton: ({ label, onPress }: { label: string; onPress: () => void }) => {
    const { Pressable: MockButton, Text } = require('react-native')
    return <MockButton accessibilityRole="button" onPress={onPress}><Text>{label}</Text></MockButton>
  },
}))

const initial = useSettingsStore.getState()
function release(patch: Partial<ApkReleaseInfo> = {}): ApkReleaseInfo {
  return {
    version: '2.0.0', tagName: 'v2.0.0', name: 'Release', htmlUrl: 'https://example.test/release',
    apkUrl: 'https://example.test/update.apk', apkName: 'update.apk', publishedAt: null,
    releaseNotesComplete: true, ...patch,
  }
}
beforeEach(() => {
  jest.clearAllMocks()
  useSettingsStore.setState({ ...initial, settings: { ...initial.settings, language: 'en' } }, true)
})
afterEach(() => { useSettingsStore.setState(initial, true); jest.restoreAllMocks() })

it('renders all forty releases and fifty categorized changes with source versions', async () => {
  const entries = Array.from({ length: 40 }, (_, index) => ({
    sourceId: `release:${index}`, version: `0.1.${1687 + index + (index > 20 ? 2 : 0)}`,
    notes: index < 7 ? `### New features\n- Feature ${index}`
      : index < 24 ? `### Improvements\n- Improvement ${index}`
        : index < 39 ? `### Bug fixes\n- Fix ${index}` : '### Privacy\n- Privacy 39',
  }))
  entries[0].notes += '\n### Bug fixes\n' + Array.from({ length: 10 }, (_, index) => `- Extra fix ${index}`).join('\n')
  const screen = await render(<ApkUpdateReleaseNotes release={release({ version: '0.1.1728', releaseNotes: entries })}
    installedVersion="0.1.1686" />)
  expect(screen.getByText('40 releases \u00b7 v0.1.1687 \u2013 v0.1.1728')).toBeTruthy()
  for (const heading of ['New features 7', 'Improvements 17', 'Bug fixes 25', 'Privacy 1']) expect(screen.getByRole('header', { name: heading })).toBeTruthy()
  expect(screen.getAllByText(/^-\s(?:Feature|Improvement|Fix|Privacy|Extra fix) \d+$/)).toHaveLength(50)
  const body = within(screen.getByTestId('apk-update-release-notes'))
  expect(body.getAllByText('v0.1.1687')).toHaveLength(11)
  expect(body.getByText('v0.1.1728')).toBeTruthy()
  expect(body.queryByText(mockTranslate('updates.releaseNotesIncomplete'))).toBeNull()
})

it('materializes long categories in explicit batches without changing counts or dropping the remaining content', async () => {
  const notes = '### New features\n' + Array.from({ length: 81 }, (_, index) => `- Feature ${index}`).join('\n')
  const screen = await render(<ApkUpdateReleaseNotes release={release({ releaseNotes: [{ version: '2.0.0', notes }] })}
    installedVersion="1.0.0" />)
  expect(screen.getByRole('header', { name: 'New features 81' })).toBeTruthy()
  expect(screen.getAllByText(/^- Feature \d+$/)).toHaveLength(50)
  expect(screen.queryByText('- Feature 80')).toBeNull()
  await fireEvent.press(screen.getByRole('button', { name: 'Show next 31 changes (31 remaining)' }))
  expect(screen.getAllByText(/^- Feature \d+$/)).toHaveLength(81)
  expect(screen.getByText('- Feature 80')).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
})

it('keeps issue links actionable but never opens credentials, script schemes, or images automatically', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
  const notes = '- Fix ([#3766](https://github.com/example/repo/issues/3766), [#2883](https://github.com/example/repo/issues/2883)).\n'
    + '- Unsafe [link](https://user:secret@example.test/).\n- Script [link](javascript:alert(1)).\n- Image ![alt](https://example.test/image.png)'
  const screen = await render(<ApkUpdateReleaseNotes release={release({ releaseNotes: [{ version: '2.0.0', notes }] })} installedVersion="1.0.0" />)
  expect(open).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByRole('link', { name: '#3766' }))
  expect(open).toHaveBeenCalledWith('https://github.com/example/repo/issues/3766')
  expect(screen.getAllByRole('link')).toHaveLength(3)
  expect(screen.getByText(/javascript:alert/)).toBeTruthy()
})

it('labels partial counts honestly and discloses a fallback language', async () => {
  useSettingsStore.setState({ settings: { ...initial.settings, language: 'ja' } })
  const screen = await render(<ApkUpdateReleaseNotes release={release({
    releaseNotesComplete: false,
    releaseNotes: [{ version: '2.0.0', notes: '<details><summary>English</summary>### Privacy\n- Control</details>' }],
  })} installedVersion="1.0.0" />)
  expect(screen.getByText('1 available releases \u00b7 v2.0.0 \u2013 v2.0.0')).toBeTruthy()
  expect(screen.getByText(mockTranslate('updates.releaseNotesIncomplete'))).toBeTruthy()
  expect(screen.getByText('Notes for v2.0.0 are shown in another available language.')).toBeTruthy()
  expect(screen.queryByText(/<summary>/)).toBeNull()
})
