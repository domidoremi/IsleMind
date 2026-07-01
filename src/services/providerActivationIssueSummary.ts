import { st } from '@/i18n/service'

export interface ProviderActivationIssueInput {
  providerName: string
  hadCredential: boolean
  missingToken: boolean
  modelCount: number
  testOk: boolean
  failures: Array<{ code?: string; message: string }>
}

export interface ProviderActivationIssueGroup {
  key: string
  message: string
  count: number
  providerNames: string[]
  hiddenProviderCount: number
  line: string
}

export function summarizeProviderActivationIssueGroups(results: ProviderActivationIssueInput[], options: { limit?: number; providerNameLimit?: number } = {}): ProviderActivationIssueGroup[] {
  const limit = Math.max(1, Math.floor(options.limit ?? 4))
  const providerNameLimit = Math.max(1, Math.floor(options.providerNameLimit ?? 4))
  const groups = new Map<string, { count: number; message: string; names: string[] }>()
  for (const item of results) {
    if (item.testOk) continue
    const message = resolveActivationIssueMessage(item)
    const key = activationIssueGroupKey(item, message)
    const current = groups.get(key) ?? { count: 0, message, names: [] }
    current.count += 1
    current.names.push(item.providerName)
    groups.set(key, current)
  }
  return Array.from(groups.entries())
    .map(([key, group]) => {
      const providerNames = group.names.slice(0, providerNameLimit)
      const hiddenProviderCount = Math.max(0, group.names.length - providerNames.length)
      const namesText = hiddenProviderCount ? `${providerNames.join(', ')} +${hiddenProviderCount}` : providerNames.join(', ')
      return {
        key,
        message: group.message,
        count: group.count,
        providerNames,
        hiddenProviderCount,
        line: st('providerActivation.issueGroupLine', { count: group.count, message: group.message, names: namesText }),
      }
    })
    .sort((left, right) => right.count - left.count || left.message.localeCompare(right.message))
    .slice(0, limit)
}

function resolveActivationIssueMessage(result: ProviderActivationIssueInput): string {
  if (result.missingToken || !result.hadCredential) return st('providerActivation.missingToken')
  if (!result.modelCount) return st('providerActivation.noModels')
  return result.failures.at(-1)?.message?.trim() || st('providerActivation.stageFailed', { name: result.providerName })
}

function activationIssueGroupKey(result: ProviderActivationIssueInput, message: string): string {
  if (result.missingToken || !result.hadCredential) return 'missing_token'
  if (!result.modelCount) return 'empty_models'
  return `${result.failures.at(-1)?.code ?? 'unknown'}:${message}`
}
