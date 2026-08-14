import type { ProviderOperationCode, ProviderTestStatus } from '@/types/providerContracts'

export interface ProviderModelTestHealthProjection {
  lastTestStatus: ProviderTestStatus
  credentialGroupHealth?: boolean
}

const BLOCKING_MODEL_TEST_CODES = new Set<ProviderOperationCode>([
  'missing_key',
  'credential_mismatch',
  'bad_auth',
  'bad_base_url',
  'model_unavailable',
  'empty_models',
])

const CREDENTIAL_FAILURE_CODES = new Set<ProviderOperationCode>([
  'missing_key',
  'credential_mismatch',
  'bad_auth',
  'model_unavailable',
])

/** Keeps partial probe evidence from becoming a durable Chat admission block. */
export function projectProviderModelTestHealth(
  result: { ok: boolean; code: ProviderOperationCode },
): ProviderModelTestHealthProjection {
  if (result.ok) {
    return {
      lastTestStatus: 'ok',
      credentialGroupHealth: true,
    }
  }
  if (!BLOCKING_MODEL_TEST_CODES.has(result.code)) {
    return { lastTestStatus: 'idle' }
  }
  return {
    lastTestStatus: 'bad',
    ...(CREDENTIAL_FAILURE_CODES.has(result.code)
      ? { credentialGroupHealth: false }
      : {}),
  }
}
