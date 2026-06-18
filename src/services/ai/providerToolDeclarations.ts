import { asRecord } from '@/services/ai/providerJsonUtils'

export function mergeProviderToolDeclarations(providerTools?: readonly unknown[], builtInTools: readonly unknown[] = []): unknown[] | undefined {
  const tools = [
    ...cloneProviderToolDeclarations(builtInTools),
    ...cloneProviderToolDeclarations(providerTools),
  ]
  return tools.length ? tools : undefined
}

export function cloneProviderToolDeclarations(tools?: readonly unknown[]): Record<string, unknown>[] {
  if (!Array.isArray(tools)) return []
  return tools
    .map((tool) => {
      const record = asRecord(tool)
      return record ? { ...record } : undefined
    })
    .filter((tool): tool is Record<string, unknown> => !!tool)
}
