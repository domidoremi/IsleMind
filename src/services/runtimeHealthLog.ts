import { appendRuntimeLog, readStoredRuntimeLogOptions } from '@/services/runtimeLog'
import type { McpServerConfig, McpToolManifest } from '@/types'
import type { RuntimeLogOptions } from '@/services/runtimeLog'

export interface RuntimeHealthErrorFields {
  errorName?: string
  errorText?: string
  errorStack?: string
}

export interface StorageOperationFailureInput {
  operation: 'load' | 'save' | 'remove' | 'clear' | 'import'
  storageKey?: string
  detail?: string
  error: unknown
}

export interface RenderErrorLogInput {
  label?: string
  compact?: boolean
  fallbackText?: string
  componentStack?: string
  error: Error
}

export interface McpOperationLogInput {
  phase: 'manifest_refresh' | 'tool_call'
  server: Pick<McpServerConfig, 'id' | 'name' | 'transport' | 'status' | 'url'>
  tool?: Pick<McpToolManifest, 'name' | 'permission' | 'enabled'>
  method?: string
  status: 'done' | 'error' | 'skipped' | 'cancelled'
  reason?: string
  error?: unknown
  detail?: string
  resultCount?: number
  options?: RuntimeLogOptions
}

export interface ContextOperationLogInput {
  phase: 'initialize' | 'knowledge_import' | 'memory_extract' | 'knowledge_retrieval' | 'knowledge_embedding'
  status: 'done' | 'error' | 'skipped' | 'cancelled'
  reason?: string
  detail?: string
  sourceType?: 'text' | 'pdf' | 'plain_text' | 'memory_model'
  title?: string
  providerId?: string
  model?: string
  options?: RuntimeLogOptions
  error?: unknown
}

export async function logStorageOperationFailure(input: StorageOperationFailureInput): Promise<void> {
  const options = await readStoredRuntimeLogOptions()
  await appendRuntimeLog('storage.operation', {
    operation: input.operation,
    storageKey: input.storageKey,
    detail: input.detail,
    status: 'error',
    ...runtimeHealthErrorFields(input.error),
  }, options)
}

export async function logRenderError(input: RenderErrorLogInput): Promise<void> {
  const options = await readStoredRuntimeLogOptions()
  await appendRuntimeLog('render.error', {
    label: input.label,
    compact: input.compact === true,
    fallbackTextPresent: !!input.fallbackText?.trim(),
    fallbackTextLength: input.fallbackText?.length ?? 0,
    componentStack: input.componentStack,
    status: 'error',
    ...runtimeHealthErrorFields(input.error),
  }, options)
}

export async function logMcpOperation(input: McpOperationLogInput): Promise<void> {
  const options = input.options ?? await readStoredRuntimeLogOptions()
  await appendRuntimeLog('mcp.operation', {
    phase: input.phase,
    status: input.status,
    reason: input.reason,
    method: input.method,
    detail: input.detail,
    resultCount: input.resultCount,
    serverId: input.server.id,
    serverName: input.server.name,
    transport: input.server.transport,
    connectionStatus: input.server.status,
    serverUrl: input.server.url,
    toolName: input.tool?.name,
    permission: input.tool?.permission,
    toolEnabled: input.tool?.enabled,
    ...runtimeHealthErrorFields(input.error),
  }, options)
}

export async function logContextOperation(input: ContextOperationLogInput): Promise<void> {
  const options = input.options ?? await readStoredRuntimeLogOptions()
  await appendRuntimeLog('context.operation', {
    phase: input.phase,
    status: input.status,
    reason: input.reason,
    detail: input.detail,
    sourceType: input.sourceType,
    title: input.title,
    providerId: input.providerId,
    model: input.model,
    ...runtimeHealthErrorFields(input.error),
  }, options)
}

export function runtimeHealthErrorFields(error: unknown): RuntimeHealthErrorFields {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorText: error.message,
      errorStack: error.stack,
    }
  }
  return {
    errorText: typeof error === 'string' ? error : String(error),
  }
}
