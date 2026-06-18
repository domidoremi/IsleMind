import type { AIProvider } from '@/types'
import { parseProviderImportText } from '@/services/ai/providerRegistry'

export function countDetectedProviderImports(input: string): number {
  return input.trim() ? parseProviderImportText(input).providers.length : 0
}

export function formatProviderNameList(providers: Pick<AIProvider, 'name'>[]): string {
  return providers
    .map((provider) => provider.name.trim())
    .filter(Boolean)
    .map((name) => `- ${name}`)
    .join('\n')
}
