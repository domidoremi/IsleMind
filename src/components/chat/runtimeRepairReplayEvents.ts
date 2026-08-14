import { emitRuntimeEvent, type RuntimeControlPlaneEvent } from '@/services/runtimeEvents'

import type { RuntimeRepairIntent } from './RuntimeRepairIntentCard'

export function emitRuntimeRepairReplayEvent({
  conversationId,
  event,
  intent,
  trigger,
}: {
  conversationId: string
  event: RuntimeControlPlaneEvent
  intent: RuntimeRepairIntent
  trigger: string
}) {
  void emitRuntimeEvent({
    event,
    conversationId,
    data: {
      trigger,
      payloadSchema: intent.payloadSchema,
      action: intent.action,
      target: intent.target,
      runtimeEvent: intent.event,
      severity: intent.severity,
      scope: intent.scope,
      issueCodes: intent.issueCodes.slice(0, 8),
      latestEventId: intent.latestEventId,
      sourceEventIds: intent.sourceEventIds.slice(0, 8),
      eventCount: intent.eventCount,
      repairStepCount: intent.repairStepCount,
      summary: intent.summary,
    },
  })
}
