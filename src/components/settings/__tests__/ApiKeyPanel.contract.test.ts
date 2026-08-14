import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(__dirname, '..', 'ApiKeyPanel.tsx'), 'utf8')

function sourceBetween(start: string, end: string): string {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  expect(startIndex).toBeGreaterThanOrEqual(0)
  expect(endIndex).toBeGreaterThan(startIndex)
  return source.slice(startIndex, endIndex)
}

describe('ApiKeyPanel provider workspace contract', () => {
  it('persists token groups and reports the result through a toast', () => {
    const tokenSaveSource = sourceBetween(
      'async function savePendingTokens()',
      'function applyProviderImportDraftText(',
    )

    expect(tokenSaveSource).toContain('await updateProvider(provider.id, { credentialGroups })')
    expect(tokenSaveSource).toContain("dialog.toast({ title: t('apiKeyPanel.tokensSaved'")
    expect(tokenSaveSource).not.toContain('dialog.notice(')
    expect(tokenSaveSource).not.toContain('setNotice(')
  })

  it('keeps model fetching on the Models page and connection saving on Connection', () => {
    expect(source.match(/apiKeyPanel\.fetchModelsAndTest/g)).toHaveLength(1)
    expect(source).toContain(
      "workspaceView === 'models' ? (\n            <ActionButton label={t('apiKeyPanel.fetchModelsAndTest')}",
    )
    expect(source).toContain(
      "workspaceView === 'connection' ? (\n            <ActionButton label={t('apiKeyPanel.saveConnection')}",
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
