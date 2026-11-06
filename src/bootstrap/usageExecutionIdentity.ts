let sequence = 0

export function nextUsageExecutionId(prefix: 'request' | 'response'): string {
  sequence = (sequence + 1) % Number.MAX_SAFE_INTEGER
  return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}-${Math.random().toString(36).slice(2, 14)}`
}
