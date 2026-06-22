import type { Message, ProcessTrace } from '@/types'
import { redactSensitiveText } from '@/services/agent/agentTrace'
import { sanitizeTraceMetadata } from '@/utils/traceSafety'

export interface SettleRunningTracesOptions {
  fallbackStatus: ProcessTrace['status']
  fallbackContent: string
}

export function completeTrace(trace: ProcessTrace): ProcessTrace {
  const completedAt = trace.completedAt ?? Date.now()
  return {
    ...trace,
    completedAt,
    durationMs: trace.startedAt ? completedAt - trace.startedAt : trace.durationMs,
  }
}

export function sanitizeTrace(trace: ProcessTrace): ProcessTrace {
  const content = trace.content?.trim()
  const status = trace.status === 'running' && trace.completedAt ? 'done' : trace.status
  return {
    ...trace,
    title: redactSensitiveText(trace.title),
    status,
    content: content ? clampTraceContent(redactSensitiveText(content), trace.type) : undefined,
    metadata: sanitizeTraceMetadata(trace.metadata),
  }
}

export function clampTraceContent(content: string, type: ProcessTrace['type']): string {
  const limit = type === 'tool' ? 520 : type === 'reasoning' ? 760 : 1400
  return content.length > limit ? `${content.slice(0, limit)}...` : content
}

export function tracesNeedingSettlement(
  message: Pick<Message, 'retrievalTrace' | 'reasoning' | 'toolCalls'> | null | undefined,
): ProcessTrace[] {
  const traces = [
    ...(message?.retrievalTrace ?? []),
    ...(message?.reasoning ?? []),
    ...(message?.toolCalls ?? []),
  ]
  return traces.filter((trace) => trace.status === 'running' || trace.status === 'pending')
}

export function settleTrace(trace: ProcessTrace, options: SettleRunningTracesOptions): ProcessTrace {
  return completeTrace({
    ...trace,
    status: options.fallbackStatus,
    content: trace.content ?? options.fallbackContent,
  })
}

export function settleMessageTraces(
  message: Pick<Message, 'retrievalTrace' | 'reasoning' | 'toolCalls'> | null | undefined,
  options: SettleRunningTracesOptions,
): ProcessTrace[] {
  return tracesNeedingSettlement(message).map((trace) => settleTrace(trace, options))
}
