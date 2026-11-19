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
  it('provides native-tool declaration labels and scope guidance in every shipped language', () => {
    for (const language of ['en', 'ja', 'zh-CN']) {
      const messages = JSON.parse(readFileSync(join(__dirname, '../../../i18n/resources', `${language}.json`), 'utf8')).apiKeyPanel
      expect(messages.capability.nativeTools).toEqual(expect.any(String))
      expect(messages.capability.nativeTools.trim()).not.toBe('')
      expect(messages.nativeToolsDeclarationHint).toEqual(expect.any(String))
      expect(messages.nativeToolsDeclarationHint.trim()).not.toBe('')
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
