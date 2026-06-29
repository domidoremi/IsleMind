import type { RuntimeLogEvent } from '@/services/runtimeLog'

export const RUNTIME_EVENT_SCHEMA = 'islemind.runtime-event.v1'
export const RUNTIME_EVENT_SKIPPED_LOG_EVENTS: RuntimeControlPlaneEvent[] = ['token_usage.updated']
export const RUNTIME_EVENT_SKIPPED_SUBSCRIBER_EVENTS: RuntimeControlPlaneEvent[] = ['token_usage.updated']

export type RuntimeControlPlaneEvent =
  | 'provider.gateway.outcome'
  | 'provider.access.decided'
  | 'provider.route.decided'
  | 'provider.route.snapshot.created'
  | 'provider.conformance.checked'
  | 'provider.proxy.decided'
  | 'provider.request.started'
  | 'provider.response.completed'
  | 'provider.error'
  | 'provider.retry.scheduled'
  | 'provider.fallback.decided'
  | 'provider.circuit.changed'
  | 'tool.gateway.outcome'
  | 'tool.mcp.compatibility.checked'
  | 'agent.security.evaluation.checked'
  | 'session.lease.acquired'
  | 'session.lease.rejected'
  | 'session.affinity.resolved'
  | 'session.affinity.bound'
  | 'session.affinity.invalidated'
  | 'session.affinity.rotated'
  | 'context.planned'
  | 'context.fragment.included'
  | 'context.fragment.excluded'
  | 'context.compact.decided'
  | 'context.compact.completed'
  | 'plugin.catalog.snapshot.created'
  | 'runtime.repair.replay.submitted'
  | 'runtime.repair.replay.applied'
  | 'runtime.repair.replay.dismissed'
  | 'token_usage.updated'

export function shouldPersistRuntimeEvent(event: RuntimeControlPlaneEvent): boolean {
  return !RUNTIME_EVENT_SKIPPED_LOG_EVENTS.includes(event)
}

export function shouldNotifyRuntimeEventSubscribers(event: RuntimeControlPlaneEvent): boolean {
  return !RUNTIME_EVENT_SKIPPED_SUBSCRIBER_EVENTS.includes(event)
}

export function runtimeLogEventForRuntimeEvent(event: RuntimeControlPlaneEvent): RuntimeLogEvent {
  switch (event) {
    case 'provider.gateway.outcome':
      return 'route.decision'
    case 'provider.access.decided':
      return 'access.policy'
    case 'provider.route.decided':
      return 'route.decision'
    case 'provider.route.snapshot.created':
      return 'route.snapshot'
    case 'provider.conformance.checked':
      return 'provider.conformance'
    case 'provider.proxy.decided':
      return 'proxy.policy'
    case 'provider.request.started':
      return 'upstream.request'
    case 'provider.response.completed':
    case 'token_usage.updated':
      return 'upstream.response'
    case 'provider.error':
      return 'upstream.error'
    case 'provider.retry.scheduled':
      return 'upstream.retry'
    case 'provider.fallback.decided':
      return 'fallback.decision'
    case 'provider.circuit.changed':
      return 'circuit.breaker'
    case 'tool.gateway.outcome':
    case 'tool.mcp.compatibility.checked':
    case 'agent.security.evaluation.checked':
    case 'plugin.catalog.snapshot.created':
    case 'runtime.repair.replay.submitted':
    case 'runtime.repair.replay.applied':
    case 'runtime.repair.replay.dismissed':
      return 'context.operation'
    case 'session.lease.acquired':
    case 'session.lease.rejected':
      return 'session.lease'
    case 'session.affinity.resolved':
    case 'session.affinity.bound':
    case 'session.affinity.invalidated':
    case 'session.affinity.rotated':
      return 'session.affinity'
    case 'context.planned':
    case 'context.fragment.included':
    case 'context.fragment.excluded':
      return 'context.operation'
    case 'context.compact.decided':
      return 'compact.request'
    case 'context.compact.completed':
      return 'compact.usage'
  }
}
