import { act, render } from '@testing-library/react-native'
import type { UsagePricingEntry } from '@/modules/diagnostics'
import type { UsageStatisticsContentProps } from './UsageStatisticsContent'
import { UsageStatisticsScreen } from './UsageStatisticsScreen'

let mockContent: UsageStatisticsContentProps
let mockEntries: UsagePricingEntry[]
const mockSave = jest.fn()
const mockExport = jest.fn()
const mockClipboardWrite = jest.fn()
const mockToast = jest.fn()
const mockFileWrite = jest.fn()
let mockDirectory: string | undefined
const mockProviders: unknown[] = []
jest.mock('./UsageStatisticsContent', () => ({ USAGE_PRICING_CONFLICT: 'usage_pricing_conflict', UsageStatisticsContent: (props: UsageStatisticsContentProps) => { mockContent = props; return null } }))
jest.mock('@/bootstrap/usageStatisticsRuntime', () => ({
  listUsagePricingEntries: async () => mockEntries,
  loadUsageStatistics: async () => null,
  saveUsagePricingEntry: (entry: UsagePricingEntry, expectedRevision?: string) => mockSave(entry, expectedRevision),
  exportUsageStatistics: (...args: unknown[]) => mockExport(...args),
}))
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: (select: any) => select({ providers: mockProviders, settings: {} }) }))
jest.mock('@/components/ui/isle', () => ({ useIsleDialog: () => ({ toast: mockToast }) }))
jest.mock('expo-clipboard', () => ({ setStringAsync: (text: string) => mockClipboardWrite(text) }))
jest.mock('expo-file-system/legacy', () => ({
  get cacheDirectory() { return mockDirectory },
  EncodingType: { UTF8: 'utf8' },
  writeAsStringAsync: (...args: unknown[]) => mockFileWrite(...args),
}))
jest.mock('expo-sharing', () => ({ isAvailableAsync: async () => false }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }))
beforeEach(() => {
  jest.clearAllMocks()
  mockSave.mockResolvedValue(undefined)
  mockExport.mockResolvedValue('usage fixture')
  mockClipboardWrite.mockResolvedValue(true)
  mockFileWrite.mockResolvedValue(undefined)
  mockDirectory = undefined
  mockEntries = [{ id: 'price', providerId: 'p', modelPattern: 'm', displayName: 'Model', version: 'v1', effectiveFrom: 1, source: 'manual', rates: { inputNanodollarsPerMillionTokens: 1e9, outputNanodollarsPerMillionTokens: 2e9, reasoningBilling: 'included-in-output' } }]
})
const draft = { id: 'price', providerId: 'p', modelId: 'm', inputPricePerMillion: '3', outputPricePerMillion: '4' }

it.each(['success', 'false', 'reject'] as const)('reports only a verified usage clipboard export: %s', async outcome => {
  if (outcome === 'reject') mockClipboardWrite.mockRejectedValueOnce(new Error('clipboard denied'))
  else mockClipboardWrite.mockResolvedValueOnce(outcome === 'success')
  await render(<UsageStatisticsScreen />)
  await act(async () => { mockContent.onExport('json') })
  expect(mockClipboardWrite).toHaveBeenCalledWith('usage fixture')
  expect(mockContent.exportingFormat).toBeNull()
  expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
    title: outcome === 'success' ? 'usage.exportCopied' : 'usage.exportFailed',
    tone: outcome === 'success' ? 'mint' : 'danger',
  }))
  if (outcome !== 'success') expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ tone: 'mint' }))
})

it('owns asynchronous export failures and releases its controls for a retry', async () => {
  mockExport.mockRejectedValueOnce(new Error('storage unavailable'))
  await render(<UsageStatisticsScreen />)
  await act(async () => { mockContent.onExport('csv') })
  expect(mockClipboardWrite).not.toHaveBeenCalled()
  expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'usage.exportFailed', tone: 'danger' }))
  expect(mockContent.exportingFormat).toBeNull()
  await act(async () => { mockContent.onExport('csv') })
  expect(mockClipboardWrite).toHaveBeenCalledTimes(1)
  expect(mockToast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'usage.exportCopied' }))
})

it('locks repeated export requests before React renders the disabled controls', async () => {
  let finish!: (text: string) => void
  mockExport.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve }))
  await render(<UsageStatisticsScreen />)
  await act(() => { mockContent.onExport('json'); mockContent.onExport('csv') })
  expect(mockExport).toHaveBeenCalledTimes(1)
  expect(mockContent.exportingFormat).toBe('json')
  await act(async () => { finish('pending usage fixture') })
  expect(mockClipboardWrite).toHaveBeenCalledWith('pending usage fixture')
  expect(mockContent.exportingFormat).toBeNull()
})

it('does not label a failed native clipboard fallback as an exported file', async () => {
  mockDirectory = 'file:///owned-cache/'
  mockClipboardWrite.mockResolvedValueOnce(false)
  await render(<UsageStatisticsScreen />)
  await act(async () => { mockContent.onExport('json') })
  expect(mockFileWrite).toHaveBeenCalled()
  expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'usage.exportFailed', tone: 'danger' }))
  expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ tone: 'mint' }))
})

it('checks authoritative pricing again before saving, retains newer entries and rejects deleted or changed baselines', async () => {
  await render(<UsageStatisticsScreen />)
  const baseline = mockContent.pricingOverrides[0].sourceRevision
  mockEntries = [{ ...mockEntries[0], version: 'v2' }]
  await act(async () => { await expect(mockContent.onSavePricingOverride(draft, baseline)).rejects.toThrow('usage_pricing_conflict') })
  expect(mockSave).not.toHaveBeenCalled()
  expect(mockContent.pricingOverrides[0].sourceRevision).toBe(JSON.stringify(mockEntries[0]))
  mockEntries = []
  await act(async () => { await expect(mockContent.onSavePricingOverride(draft, baseline)).rejects.toThrow('usage_pricing_conflict') })
  expect(mockSave).not.toHaveBeenCalled()
  expect(mockContent.pricingOverrides).toEqual([])
})

it('retains existing rate validation and waits for durable persistence before completing the save', async () => {
  await render(<UsageStatisticsScreen />)
  const baseline = mockContent.pricingOverrides[0].sourceRevision
  for (const inputPricePerMillion of ['-1', 'NaN', '1e100']) {
    await act(async () => { await expect(mockContent.onSavePricingOverride({ ...draft, inputPricePerMillion }, baseline)).rejects.toThrow() })
  }
  expect(mockSave).not.toHaveBeenCalled()
  let finish!: () => void
  mockSave.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  let completed = false
  let pending!: Promise<void>
  await act(async () => { pending = Promise.resolve(mockContent.onSavePricingOverride(draft, baseline)).then(() => { completed = true }) })
  expect(mockContent.savingPricingOverrideId).toBe('price')
  expect(completed).toBe(false)
  expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ rates: expect.objectContaining({ inputNanodollarsPerMillionTokens: 3e9, outputNanodollarsPerMillionTokens: 4e9 }) }), baseline)
  await act(async () => { finish(); await pending })
  expect(completed).toBe(true)
  expect(mockContent.savingPricingOverrideId).toBeNull()
})
