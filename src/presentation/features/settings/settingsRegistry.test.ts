import en from '@/i18n/resources/en.json'
import ja from '@/i18n/resources/ja.json'
import zh from '@/i18n/resources/zh-CN.json'
import { buildSettingsIndex, searchSettingsIndex, SETTINGS_CATEGORIES, SETTINGS_DESTINATIONS } from './settingsRegistry'

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
