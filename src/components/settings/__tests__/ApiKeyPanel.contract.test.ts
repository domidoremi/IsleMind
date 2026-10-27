import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(__dirname, '..', 'ApiKeyPanel.tsx'), 'utf8').replace(/\r\n/g, '\n')

function sourceBetween(start: string, end: string): string {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  expect(startIndex).toBeGreaterThanOrEqual(0)
  expect(endIndex).toBeGreaterThan(startIndex)
  return source.slice(startIndex, endIndex)
}

describe('ApiKeyPanel provider workspace contract', () => {
  it('exposes an explicit native-tool declaration without probing or granting tool permissions', () => {
    expect(sourceBetween('const CAPABILITY_KEYS:', 'function panelCardStyle(')).toContain("'nativeTools'")
    expect(source).toContain("t('apiKeyPanel.nativeToolsDeclarationHint')")
    const toggleSource = sourceBetween('async function toggleCapability(', 'function applyPresetDraft(')
    expect(toggleSource).toContain('await applyLocalProviderChange({ capabilities: next }')
    const localMutationSource = sourceBetween('async function applyLocalProviderChange(', 'async function savePendingTokens()')
    expect(localMutationSource).toContain('await updateProvider(provider.id, updates, { expectedProvider, signal })')
    expect(localMutationSource).toContain('saveLock.current = true')
    expect(localMutationSource.indexOf('await useSettingsStore.getState().flushProviderPersistence()'))
      .toBeGreaterThan(localMutationSource.indexOf('await updateProvider('))
    expect(localMutationSource.indexOf('if (!signal?.aborted && success) dialog.toast(success)'))
      .toBeGreaterThan(localMutationSource.indexOf('await useSettingsStore.getState().flushProviderPersistence()'))
    expect(localMutationSource).not.toMatch(/syncAndTestProvider|probeProviderPreset|allowedToolIds|agentWorkflowAllow/)
    expect(toggleSource).not.toMatch(/syncAndTestProvider|probeProviderPreset|allowedToolIds|agentWorkflowAllow/)
    for (const language of ['en', 'ja', 'zh-CN']) {
      const messages = JSON.parse(readFileSync(join(__dirname, '../../../i18n/resources', `${language}.json`), 'utf8')).apiKeyPanel
      expect(messages.capability.nativeTools).toBeTruthy()
      expect(messages.nativeToolsDeclarationHint).toBeTruthy()
    }
  })

  it('persists token groups and reports the result through a toast', () => {
    const tokenSaveSource = sourceBetween(
      'async function savePendingTokens()',
      'function applyProviderImportDraftText(',
    )

    expect(tokenSaveSource).toContain('await save()')
    const saveSource = sourceBetween('async function save(showNotice', 'async function selectClientCompatibilityMode')
    expect(saveSource).toContain('await updateProvider(provider.id, {')
    expect(saveSource).toContain('await useSettingsStore.getState().flushProviderPersistence()')
    expect(saveSource).toContain("dialog.toast({ title: t('apiKeyPanel.providerSaved'")
    expect(tokenSaveSource).not.toContain('dialog.notice(')
    expect(tokenSaveSource).not.toContain('setNotice(')
  })

  it('keeps optional model fetching with models and moves saved connections to model selection', () => {
    expect(source.match(/apiKeyPanel\.fetchModelsAndTest/g)).toHaveLength(1)
    const workspace = sourceBetween("workspaceView === 'models' ? <View testID=\"provider-model-workspace\"", "workspaceView === 'advanced' ? <ProviderUsageQueryEditor")
    expect(workspace).toContain("'apiKeyPanel.fetchModelsAndTest'")
    expect(workspace.indexOf('provider-model-actions')).toBeLessThan(workspace.indexOf('provider-model-choices'))
    expect(workspace).toContain("if (!hasKey) setWorkspaceView('connection'); else void syncAndTest()")
    expect(sourceBetween('async function syncAndTest()', 'async function toggleProviderEnabled()')).toContain('testModels: false')
    expect(source).toContain(
      "workspaceView === 'connection' ? (\n            <ActionButton label={t('settingsSubsystem.saveChoose')}",
    )
  })

  it('edits aliases as display-name and actual-model fields', () => {
    const aliasEditorSource = sourceBetween(
      'function ModelAliasEditor(',
      'function getRemoteModelIds(',
    )
    const modelEntrySource = sourceBetween(
      'function formatModelEntries(',
      'function normalizeAliasDrafts(',
    )

    expect(aliasEditorSource).toContain("placeholder={t('apiKeyPanel.aliasDisplayName')}")
    expect(aliasEditorSource).toContain("placeholder={t('apiKeyPanel.aliasTargetModel')}")
    expect(aliasEditorSource).toContain("onChange([...aliases, { alias: '', model: models[0] ?? '' }])")
    expect(modelEntrySource).toContain("return getProviderManualModels(provider).join('\\n')")
    expect(modelEntrySource).not.toContain('modelAliases')
  })
})
