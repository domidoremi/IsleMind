import { fireEvent, render } from '@testing-library/react-native'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'
import { getColors } from '@/theme/colors'
import type { RedactedUsageRequestDetail } from './UsageStatisticsContent'
import { UsageRequestDetail } from './UsageRequestDetail'

let mockFamily: CanonicalThemeId = 'minimal'
let mockMode: 'light' | 'dark' = 'light'
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({
  colors: require('@/theme/colors').getColors(mockMode, mockFamily), canonicalThemeId: mockFamily,
}) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

function detail(): RedactedUsageRequestDetail {
  return {
    requestId: 'request', title: 'Request detail', subtitle: '11:24', status: 'failed', statusLabel: 'Failed',
    fields: [
      { id: 'provider', label: 'Provider', value: 'Reference connection' },
      { id: 'model', label: 'Model', value: 'A long editorial model identity' },
      { id: 'original-provider', label: 'Original provider', value: 'Writing desk' },
      { id: 'original-model', label: 'Original model', value: 'First model' },
      { id: 'source', label: 'Source', value: 'Knowledge' },
      { id: 'measurement', label: 'Measurement', value: 'Provider supplied' },
      { id: 'total', label: 'Total tokens', value: '3,840' },
      { id: 'input', label: 'Input tokens', value: '3,200' },
      { id: 'output', label: 'Output tokens', value: '640' },
      { id: 'cache', label: 'Cache tokens', value: '-' },
      { id: 'reasoning', label: 'Reasoning tokens', value: '12' },
      { id: 'latency', label: 'Latency', value: '1.6s' },
      { id: 'first-token', label: 'First token', value: '0.38s' },
      { id: 'cost', label: 'Cost', value: '$0.014' },
      { id: 'retries', label: 'Retries', value: '2' },
      { id: 'failovers', label: 'Failovers', value: '1', tone: 'warning' },
      { id: 'error', label: 'Error', value: 'upstream_error', tone: 'danger' },
      { id: 'future-field', label: 'Additional field', value: 'A retained redacted value' },
    ],
  }
}
const page = (value = detail()) => <UsageRequestDetail detail={value} redactedLabel="Sensitive content is hidden" statusColor="red" />
beforeEach(() => { mockFamily = 'minimal'; mockMode = 'light' })
afterEach(() => jest.restoreAllMocks())

it('shows every redacted field exactly once, with key readings first and unknown fields retained', async () => {
  const value = detail()
  const view = await render(page(value))
  for (const field of value.fields) {
    expect(view.getAllByTestId(`usage-detail-field-${field.id}`)).toHaveLength(1)
    expect(view.getByTestId(`usage-detail-value-${field.id}`)).toHaveTextContent(field.value)
    expect(view.getByTestId(`usage-detail-value-${field.id}`).props.selectable).toBe(true)
  }
  expect(view.getByTestId('usage-detail-group-readings')).toHaveTextContent(/3,840/)
  expect(view.getByTestId('usage-detail-group-readings')).toHaveTextContent(/1.6s/)
  expect(view.getByTestId('usage-detail-group-other')).toHaveTextContent(/A retained redacted value/)
  expect(view.getByTestId('usage-detail-redaction')).toHaveTextContent('Sensitive content is hidden')
  expect(view.getByTestId('usage-detail-value-error')).toHaveStyle({ color: getColors('light', 'minimal').ui.tone.danger.foreground })
  expect(view.getByTestId('usage-detail-value-failovers')).toHaveStyle({ color: getColors('light', 'minimal').ui.tone.warning.foreground })
})

it('uses the measured sheet column and font scale to stack cells without truncating values', async () => {
  jest.spyOn(require('react-native'), 'useWindowDimensions').mockReturnValue({ width: 1000, height: 900, scale: 1, fontScale: 2 })
  const view = await render(page())
  await fireEvent(view.getByTestId('usage-request-detail'), 'layout', { nativeEvent: { layout: { width: 500, height: 900 } } })
  expect(view.getByTestId('usage-detail-cell-input')).toHaveStyle({ flexBasis: '100%' })
  expect(view.getByTestId('usage-detail-value-model').props.numberOfLines).toBeUndefined()
  await fireEvent(view.getByTestId('usage-request-detail'), 'layout', { nativeEvent: { layout: { width: 800, height: 900 } } })
  expect(view.getByTestId('usage-detail-cell-input')).toHaveStyle({ flexBasis: '44%' })
})

it('retains field identity through every theme and mode, and omits only empty groups', async () => {
  const value = detail()
  const view = await render(page(value))
  const model = view.getByTestId('usage-detail-value-model')
  const readings = view.getByTestId('usage-detail-group-readings')
  for (const family of CANONICAL_THEME_IDS) for (const mode of ['light', 'dark'] as const) {
    mockFamily = family; mockMode = mode
    await view.rerender(page(value))
    expect(view.getByTestId('usage-detail-value-model')).toBe(model)
    expect(view.getByTestId('usage-detail-group-readings')).toBe(readings)
    expect(view.getByTestId('usage-request-detail')).toHaveStyle({ backgroundColor: getColors(mode, family).material.sheet.body })
  }
  await view.rerender(page({ ...value, fields: value.fields.filter(field => field.id === 'model') }))
  expect(view.queryByTestId('usage-detail-group-timing')).toBeNull()
  expect(view.queryByTestId('usage-detail-group-diagnostics')).toBeNull()
  expect(view.getByTestId('usage-detail-value-model')).toBe(model)
})

it.each(['light', 'dark'] as const)('keeps glass detail values on an opaque %s reading plane', async mode => {
  mockFamily = 'liquid-glass'
  mockMode = mode
  const colors = getColors(mode, mockFamily)
  const view = await render(page())
  expect(colors.material.sheet.body).toMatch(/^#[\da-f]{6}$/i)
  expect(view.getByTestId('usage-request-detail')).toHaveStyle({ backgroundColor: colors.material.sheet.body })
  expect(colors.ui.semantic.chrome.sheet).not.toBe(colors.material.sheet.body)
})
