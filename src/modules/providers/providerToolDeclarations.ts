export function mergeProviderToolDeclarations(
  providerTools?: readonly unknown[],
  builtInTools: readonly unknown[] = [],
): unknown[] | undefined {
  const tools = [
    ...cloneProviderToolDeclarations(builtInTools),
    ...cloneProviderToolDeclarations(providerTools),
  ]
  return tools.length ? tools : undefined
}

export interface ProviderToolDeclarationSelectionInput {
  declarations?: readonly unknown[]
  providerToolsSupported?: boolean
  toolsCapabilityAllowed?: boolean
}

export function selectProviderToolDeclarations(
  input: ProviderToolDeclarationSelectionInput,
): readonly unknown[] | undefined {
  return input.providerToolsSupported === true && input.toolsCapabilityAllowed === true
    ? input.declarations
    : undefined
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}
