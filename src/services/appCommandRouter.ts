import type { ProcessTrace } from '@/types'
import { executeAppAction, type AppActionRequest } from '@/services/appActionPolicy'

export interface LocalAppCommandResult {
  ok: boolean
  message: string
  trace: ProcessTrace
}

type RoutedAppAction = Omit<AppActionRequest, 'source'>

export async function routeLocalAppCommand(content: string): Promise<LocalAppCommandResult | null> {
  const action = parseLocalAppCommand(content)
  if (!action) return null
  const result = await executeAppAction({ ...action, source: 'local-intent' })
  return {
    ok: result.ok,
    message: result.message,
    trace: result.trace,
  }
}

function parseLocalAppCommand(content: string): RoutedAppAction | null {
  const raw = content.trim()
  if (!raw || raw.length > 120) return null
  if (/[?？]/.test(raw)) return null
  const text = raw.toLowerCase()
  if (!hasCommandVerb(text)) return null

  const themeMode = parseThemeMode(text)
  if (themeMode) return { name: 'set_theme_mode', arguments: { mode: themeMode } }

  const themeFamily = parseThemeFamily(text)
  if (themeFamily) return { name: 'set_theme_family', arguments: { themeId: themeFamily } }

  const language = parseLanguage(text)
  if (language) return { name: 'set_language', arguments: { language } }

  const featureFlag = parseFeatureFlag(text)
  if (featureFlag) return { name: 'set_feature_flag', arguments: featureFlag }

  return null
}

function hasCommandVerb(text: string): boolean {
  return /(切换|设置|设为|改成|改为|换成|开启|打开|关闭|关掉|禁用|启用|turn\s+(on|off)|switch|set|change|enable|disable)/i.test(text)
}

function hasThemeTarget(text: string): boolean {
  return /(主题|外观|模式|theme|appearance|mode)/i.test(text)
}

function parseThemeMode(text: string): 'light' | 'dark' | 'system' | null {
  if (!hasThemeTarget(text)) return null
  if (/(跟随系统|系统主题|system)/i.test(text)) return 'system'
  if (/(深色|暗色|夜间|黑暗|dark)/i.test(text)) return 'dark'
  if (/(浅色|亮色|白天|light)/i.test(text)) return 'light'
  return null
}

function parseThemeFamily(text: string): 'island' | 'minimal' | null {
  if (!hasThemeTarget(text)) return null
  if (/(岛屿|island)/i.test(text)) return 'island'
  if (/(极简|minimal)/i.test(text)) return 'minimal'
  return null
}

function parseLanguage(text: string): 'zh-CN' | 'en' | 'ja' | null {
  if (!/(语言|界面|language|ui)/i.test(text)) return null
  if (/(简体中文|中文|chinese|zh-cn)/i.test(text)) return 'zh-CN'
  if (/(英文|英语|english|\ben\b)/i.test(text)) return 'en'
  if (/(日本語|日语|日文|japanese|\bja\b)/i.test(text)) return 'ja'
  return null
}

function parseFeatureFlag(text: string): { flag: string; enabled: boolean } | null {
  const enabled = parseEnabled(text)
  if (enabled === undefined) return null
  const flag = findFeatureFlag(text)
  return flag ? { flag, enabled } : null
}

function parseEnabled(text: string): boolean | undefined {
  const wantsEnable = /(开启|打开|启用|enable|turn\s+on|\bon\b)/i.test(text)
  const wantsDisable = /(关闭|关掉|禁用|disable|turn\s+off|\boff\b)/i.test(text)
  if (wantsEnable === wantsDisable) return undefined
  return wantsEnable
}

function findFeatureFlag(text: string): string | null {
  if (/(长记忆|记忆|memory)/i.test(text)) return 'memory'
  if (/(本地知识|知识库|知识|knowledge)/i.test(text)) return 'knowledge'
  if (/(联网搜索|网页搜索|web\s*search|搜索|search)/i.test(text)) return 'web_search'
  if (/(技能|skills?)/i.test(text)) return 'skills'
  if (/\bmcp\b/i.test(text)) return 'mcp'
  if (/(命令面板|command\s*palette)/i.test(text)) return 'command_palette'
  if (/(触感|震动|haptics?)/i.test(text)) return 'haptics'
  return null
}
