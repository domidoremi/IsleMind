import type { ToolAdapter, ToolDefinition, ToolRequest, ToolResult } from './contracts'

export interface LocalToolDescriptor {
  id: string
  source: Extract<ToolDefinition['source'], 'builtin' | 'android'>
  capabilityScope: readonly string[]
  requiresConfirmation: boolean
  enabled: boolean
}

export type LocalToolExecutor = (
  request: ToolRequest,
  options: { signal: AbortSignal },
) => Promise<ToolResult>

/** Creates a source-specific local adapter without granting it a task lifecycle. */
export function createLocalToolAdapter(descriptor: LocalToolDescriptor, execute: LocalToolExecutor): ToolAdapter {
  if (!descriptor.enabled) throw new Error(`Local tool ${descriptor.id} is disabled.`)
  return {
    definition: {
      id: descriptor.id,
      source: descriptor.source,
      capabilityScope: descriptor.capabilityScope,
      requiresConfirmation: descriptor.requiresConfirmation,
    },
    execute,
  }
}
