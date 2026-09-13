import type { Message } from '@/types/chatContracts'
import { PROVIDER_PROTOCOL_ADAPTER_IDS } from '@/types/providerContracts'
import type { ProviderExecutionTarget } from '@/modules/providers'
import type { AssistantRun, AssistantRunRouteDetails } from '../contracts'

const ADAPTERS = new Set<string>(PROVIDER_PROTOCOL_ADAPTER_IDS)

export function decodeAssistantRunRouteDetails(value: unknown): AssistantRunRouteDetails | undefined {
  if (value == null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid assistant route details')
  const record = value as AssistantRunRouteDetails
  const source = record.credentialSource
  if (record.schema !== 'islemind.assistant-run-route-details.v1' || !ADAPTERS.has(record.protocolAdapterId)
    || !identityString(record.endpointVariant) || !identityString(record.attemptId)
    || !source || !['primary', 'none', 'group'].includes(source.kind)
    || (source.kind === 'group' && !identityString(source.groupId))
    || (record.scope !== undefined && (!identityString(record.scope?.scopeId) || !identityString(record.scope?.epoch)))) {
    throw new Error('Unsupported or invalid assistant route details')
  }
  return {
    schema: record.schema, protocolAdapterId: record.protocolAdapterId,
    endpointVariant: record.endpointVariant, attemptId: record.attemptId,
    credentialSource: source.kind === 'group' ? { kind: 'group', groupId: source.groupId } : { kind: source.kind },
    ...(record.scope ? { scope: { scopeId: record.scope.scopeId, epoch: record.scope.epoch } } : {}),
  }
}

export function createAssistantRunRouteDetails(target: ProviderExecutionTarget): AssistantRunRouteDetails {
  if (!identityString(target.providerId) || !identityString(target.model)) throw new Error('Invalid actual provider target')
  return decodeAssistantRunRouteDetails({ ...target, schema: 'islemind.assistant-run-route-details.v1' })!
}

/** A disposable message projection, never a source of route or credential authority. */
export function getAssistantRunMessageAttribution(run: AssistantRun): Pick<Message, 'providerId' | 'model' | 'generationProtocol'> | undefined {
  // routeDetails is committed only with producing text or tool-call evidence.
  // Requiring text here would discard valid tool-only cancellation attribution.
  if (!run.routeDetails) return undefined
  return {
    providerId: run.providerId, model: run.model,
    generationProtocol: { schema: 'islemind.message-protocol.v1', adapterId: run.routeDetails.protocolAdapterId },
  }
}

function identityString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 512 && !/[\u0000-\u001f]/u.test(value)
}
