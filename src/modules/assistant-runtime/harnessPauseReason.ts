export const HARNESS_PAUSE_REASONS = ['caller_requested', 'memory_pressure', 'background_lease', 'application_background',
  'budget_exhausted', 'price_unknown', 'context_capacity', 'storage_pressure', 'process_restart'] as const
export type HarnessPauseReason = typeof HARNESS_PAUSE_REASONS[number]
