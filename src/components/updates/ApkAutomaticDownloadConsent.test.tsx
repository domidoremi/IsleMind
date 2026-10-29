import { fireEvent, render } from '@testing-library/react-native'

import { ApkAutomaticDownloadConsent } from './ApkAutomaticDownloadConsent'

let mockTheme = 'material'
let mockScheme = 'light'
let mockLanguage = 'zh-CN'

jest.mock('@/hooks/useAppTheme', () => ({
  useAppTheme: () => {
    const colors = require('@/theme/colors').getColors(mockScheme, mockTheme)
    return { colors, design: colors.design, canonicalThemeId: mockTheme }
  },
}))
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (path: string) => {
      const [section, key] = path.split('.')
      return require(`@/i18n/resources/${mockLanguage}.json`)[section]?.[key] ?? path
    },
  }),
}))
jest.mock('@/components/ui/isle', () => ({ IslePressable: require('react-native').Pressable }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))

const copy = require('@/i18n/resources/zh-CN.json').updates

beforeEach(() => { mockTheme = 'material'; mockScheme = 'light'; mockLanguage = 'zh-CN' })

it('keeps every download condition, the installation boundary and data-charge warning visible by default', async () => {
  const screen = await render(<ApkAutomaticDownloadConsent />)
  for (const key of ['autoDownloadConditions', 'autoDownloadForeground', 'autoDownloadWifi', 'autoDownloadProxyOff',
    'autoDownloadInstallBoundary', 'autoDownloadInstallDetail', 'autoDownloadMeteredWarning']) {
    expect(screen.getByText(copy[key])).toBeTruthy()
  }
  expect(screen.queryByTestId('apk-auto-download-details')).toBeNull()
  expect(screen.queryByText(copy.autoDownloadNetworkDetail)).toBeNull()
  expect(screen.queryByText(copy.autoDownloadControlDetail)).toBeNull()
  expect(screen.getByRole('button', { name: copy.autoDownloadDetails }).props.accessibilityState).toMatchObject({ expanded: false })
})

it('expands and collapses optional details without presenting a second consent action', async () => {
  const screen = await render(<ApkAutomaticDownloadConsent />)
  const disclosure = screen.getByRole('button', { name: copy.autoDownloadDetails })
  expect(screen.getAllByRole('button')).toHaveLength(1)
  expect(disclosure).toHaveStyle({ minHeight: 44 })
  await fireEvent.press(disclosure)
  expect(screen.getByRole('button', { name: copy.autoDownloadDetails }).props.accessibilityState).toMatchObject({ expanded: true })
  expect(screen.getByText(copy.autoDownloadNetworkDetail)).toBeTruthy()
  expect(screen.getByText(copy.autoDownloadControlDetail)).toBeTruthy()
  expect(screen.getByText(copy.autoDownloadInstallDetail)).toBeTruthy()
  await fireEvent.press(disclosure)
  expect(screen.getByRole('button', { name: copy.autoDownloadDetails }).props.accessibilityState).toMatchObject({ expanded: false })
  expect(screen.queryByTestId('apk-auto-download-details')).toBeNull()
})

it.each(['animal-island-ui', 'minimal', 'monet', 'material', 'liquid-glass'].flatMap(theme =>
  ['light', 'dark'].flatMap(scheme => ['zh-CN', 'en', 'ja'].map(language => [theme, scheme, language] as const)),
))('keeps %s / %s / %s consent text flexible and complete', async (theme, scheme, language) => {
  mockTheme = theme
  mockScheme = scheme
  mockLanguage = language
  const updates = require(`@/i18n/resources/${language}.json`).updates
  const screen = await render(<ApkAutomaticDownloadConsent />)
  expect(screen.getByTestId('apk-auto-download-consent')).toHaveStyle({ width: '100%' })
  for (const key of ['autoDownloadForeground', 'autoDownloadWifi', 'autoDownloadProxyOff']) {
    const text = screen.getByText(updates[key])
    expect(text.props.numberOfLines ?? 0).toBe(0)
    expect(text).toHaveStyle({ flex: 1, minWidth: 0 })
  }
  await fireEvent.press(screen.getByRole('button', { name: updates.autoDownloadDetails }))
  for (const key of ['autoDownloadInstallDetail', 'autoDownloadNetworkDetail', 'autoDownloadControlDetail']) {
    const text = screen.getByText(updates[key])
    expect(text.props.numberOfLines ?? 0).toBe(0)
    expect(text.props.allowFontScaling).not.toBe(false)
  }
})
