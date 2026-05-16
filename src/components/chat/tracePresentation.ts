import type { Message, ProcessTrace } from '@/types'

export interface TraceSummary {
  total: number
  done: number
  errors: number
  skipped: number
  running: number
  label: string
}

export function collectMessageTraces(message: Message): ProcessTrace[] {
  return [
    ...(message.retrievalTrace ?? []),
    ...(message.reasoning ?? []),
    ...(message.toolCalls ?? []),
  ].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
}

export function normalizeTraceStatuses(traces: ProcessTrace[], messageStatus: Message['status']): ProcessTrace[] {
  const messageSettled = messageStatus !== 'streaming'
  return traces.map((trace) => {
    if ((trace.status === 'running' || trace.status === 'pending') && trace.completedAt) {
      return { ...trace, status: 'done' as const }
    }
    if (messageSettled && (trace.status === 'running' || trace.status === 'pending')) {
      const nextStatus = trace.content ? 'done' : 'skipped'
      return { ...trace, status: nextStatus }
    }
    return trace
  })
}

export function summarizeTraces(traces: ProcessTrace[], messageStatus: Message['status']): TraceSummary {
  const normalized = normalizeTraceStatuses(traces, messageStatus)
  const done = normalized.filter((trace) => trace.status === 'done').length
  const errors = normalized.filter((trace) => trace.status === 'error').length
  const skipped = normalized.filter((trace) => trace.status === 'skipped').length
  const running = normalized.filter((trace) => trace.status === 'running' || trace.status === 'pending').length
  const label = [
    running ? `${running} 运行中` : '',
    done ? `${done} 完成` : '',
    errors ? `${errors} 异常` : '',
    skipped ? `${skipped} 跳过` : '',
  ].filter(Boolean).join(' · ') || '无过程'
  return { total: normalized.length, done, errors, skipped, running, label }
}

export function getActiveTraceTitle(traces: ProcessTrace[], messageStatus: Message['status']): string {
  const normalized = normalizeTraceStatuses(traces, messageStatus)
  return (
    normalized.find((trace) => trace.status === 'running' || trace.status === 'pending')?.title ??
    normalized.find((trace) => trace.status === 'error')?.title ??
    ''
  )
}

export function metadataSummary(metadata?: Record<string, unknown>): string {
  if (!metadata) return ''
  const parts = [
    typeof metadata.sourceCount === 'number' ? `来源 ${metadata.sourceCount}` : '',
    typeof metadata.memoryCount === 'number' ? `记忆 ${metadata.memoryCount}` : '',
    typeof metadata.knowledgeCount === 'number' ? `知识 ${metadata.knowledgeCount}` : '',
    typeof metadata.count === 'number' ? `数量 ${metadata.count}` : '',
    typeof metadata.providerCitationCount === 'number' ? `网页 ${metadata.providerCitationCount}` : '',
  ].filter(Boolean)
  return parts.slice(0, 2).join(' · ')
}

export function traceStatusLabel(status: ProcessTrace['status']): string {
  switch (status) {
    case 'pending':
      return '准备中'
    case 'running':
      return '运行中'
    case 'done':
      return '完成'
    case 'error':
      return '异常'
    case 'skipped':
      return '跳过'
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`
  return `${Math.round(ms / 60000)}m`
}

export function formatNumber(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `${Math.round(value / 1000)}K`
  return String(value)
}
