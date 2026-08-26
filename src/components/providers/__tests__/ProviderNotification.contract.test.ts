import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const providerSettingsSource = readFileSync(join(__dirname, '..', 'ProviderSettingsContent.tsx'), 'utf8')
const activationSource = readFileSync(join(__dirname, '..', 'useProviderActivationJob.ts'), 'utf8')

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  expect(startIndex).toBeGreaterThanOrEqual(0)
  expect(endIndex).toBeGreaterThan(startIndex)
  return source.slice(startIndex, endIndex)
}

describe('provider notification contract', () => {
  it('uses the import confirmation as the only foreground success surface', () => {
    const importFlow = sourceBetween(
      providerSettingsSource,
      'async function importProvidersFromText(',
      '  async function enableEffectiveSelection()',
    )

    expect(importFlow).toContain('const enableNow = await dialog.confirm({')
    expect(importFlow).not.toContain("title: t('providerSettings.importDone')")
    expect(importFlow).not.toContain('publishProviderImportCompletedNotification')
    expect(importFlow).toContain('void clearAndroidStatusNotification({ owner: notificationOwner })')
  })

  it('keeps native status updates for progress only and gates them by preference', () => {
    const importNotification = sourceBetween(
      providerSettingsSource,
      'function publishProviderImportStatusNotification(',
      'function publishProviderDeleteNotification(',
    )
    const deleteNotification = sourceBetween(
      providerSettingsSource,
      'function publishProviderDeleteNotification(',
      'function useKeyboardAwareModalRequestClose(',
    )

    expect(importNotification).toContain('if (!enabled) return Promise.resolve')
    expect(importNotification).toContain("state: 'running'")
    expect(importNotification).toContain('}, { enabled: true, owner })')
    expect(deleteNotification).toContain('if (!enabled) return Promise.resolve')
    expect(deleteNotification).toContain("state: 'running'")
    expect(deleteNotification).toContain('}, { enabled: true, owner })')
  })

  it('does not enqueue duplicate activation or supplier-delete start toasts', () => {
    const activationFlow = sourceBetween(
      activationSource,
      'async function activateProviders(',
      '  return {\n    activationBusy',
    )
    const deleteFlow = sourceBetween(
      providerSettingsSource,
      '  async function confirmRemoveSupplierGroup(',
      '  function toggleSelection(',
    )

    expect(activationFlow).not.toContain('const startTitle')
    expect(activationFlow).not.toContain("title: startTitle")
    expect(deleteFlow).not.toContain("title: t('providerSettings.deleteSupplierStarted')")
    expect(deleteFlow).toContain("title: t('providerSettings.deleteSupplierDone')")
    expect(activationFlow).toContain("dedupeKey: 'provider-activation'")
  })
})
