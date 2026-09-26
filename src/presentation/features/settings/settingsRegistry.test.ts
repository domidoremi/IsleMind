import en from '@/i18n/resources/en.json'
import ja from '@/i18n/resources/ja.json'
import zh from '@/i18n/resources/zh-CN.json'
import { buildSettingsIndex, searchSettingsIndex, settingsHelpTopic, SETTINGS_CATEGORIES, SETTINGS_DESTINATIONS } from './settingsRegistry'

const translation = (resource: unknown) => (key: string): string => {
  const value = key.split('.').reduce<unknown>((node, part) => node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined, resource)
  if (typeof value !== 'string') throw Error(`Missing translation: ${key}`)
  return value
}
it('has six categories, unique IDs, and translated destinations in every language', () => {
  expect(SETTINGS_CATEGORIES).toHaveLength(6)
  expect(new Set(SETTINGS_DESTINATIONS.map(entry => entry.id)).size).toBe(SETTINGS_DESTINATIONS.length)
  for (const resource of [zh, en, ja]) expect(buildSettingsIndex(translation(resource))).toHaveLength(SETTINGS_DESTINATIONS.length)
})
it.each(['温度', 'temperature', 'サンプリング', 'ＴＥＭＰＥＲＡＴＵＲＥ'])('finds the actual generation field for %s', query => {
  expect(searchSettingsIndex(buildSettingsIndex(translation(en)), query).some(entry => entry.section === 'generation-temperature')).toBe(true)
})
it('searches advanced fields without importing or mounting screens', () => {
  const result = searchSettingsIndex(buildSettingsIndex(translation(en)), 'proxyBaseUrl')
  expect(result).toEqual([expect.objectContaining({ section: 'governance.proxyBaseUrl', parentSection: 'routing' })])
  expect(searchSettingsIndex(buildSettingsIndex(translation(en)), '   ')).toEqual([])
  expect(SETTINGS_DESTINATIONS.every(entry => !('value' in entry) && !('apiKey' in entry))).toBe(true)
})

it.each(['agentWorkflowMaxSteps', '工具调用上限', '出力文字数'])('locates a folded workflow field for %s', query => {
  expect(searchSettingsIndex(buildSettingsIndex(translation(en)), query)).toEqual([
    expect.objectContaining({ parentSection: 'workflow', section: expect.stringMatching(/^workflow-/) }),
  ])
})

it.each([
  ['generation', 'models'], ['generation-temperature', 'models'],
  ['workflow', 'tools'], ['workflow-tools', 'tools'],
  ['interaction', 'personalization'], ['identity', 'personalization'],
])('opens the matching help chapter for shared preferences section %s', (section, topic) => {
  expect(settingsHelpTopic('/settings/preferences', section)).toBe(topic)
})

it('keeps page and unknown-route help fallbacks without treating another page section as a match', () => {
  expect(settingsHelpTopic('/settings/providers', 'workflow')).toBe('models')
  expect(settingsHelpTopic('/settings/preferences')).toBe('models')
  expect(settingsHelpTopic('/settings/unknown', 'workflow')).toBe('quick-start')
})

it.each(['download mirror', 'mirror address', '下载 镜像', '镜像地址', 'ダウンロード ミラー', 'ミラーアドレス'])('finds the nested model mirror field for %s', query => {
  expect(searchSettingsIndex(buildSettingsIndex(translation(en)), query)).toEqual([
    expect.objectContaining({ section: 'local-model-mirror', parentSection: 'rag-profile', helpTopic: 'search' }),
  ])
})
