import type { AIProvider } from '@/types/providerContracts'
import type { SearchProviderId } from '@/types/settingsContracts'
import type { ProviderNativeSearchSupportModel } from './providerNativeSearch'

export type ProviderConversationNativeSearchCompatibilityReason =
  | 'provider_native_search_unclaimed'
  | 'provider_native_search_model_unsupported'

export type ProviderConversationNativeSearchDisplayState =
  | 'requested'
  | 'attachments_blocked'
  | 'disabled'

export interface ProviderConversationNativeSearchAdmissionInput {
  readonly provider: AIProvider
  readonly modelConfig: ProviderNativeSearchSupportModel
  readonly requestedMode: SearchProviderId
  readonly hasAttachments: boolean
}

export interface ProviderConversationNativeSearchAdmissionDependencies {
  providerSupportsNativeSearch(
    provider: AIProvider,
    model?: ProviderNativeSearchSupportModel,
  ): boolean
}

interface ProviderConversationNativeSearchAdmissionBase {
  readonly requestedMode: SearchProviderId
  readonly nativeSearchSupported: boolean
}

export interface ProviderConversationNativeSearchAdmitted
  extends ProviderConversationNativeSearchAdmissionBase {
  readonly kind: 'admitted'
  readonly webSearchMode: 'native'
  readonly displayState: 'requested'
  readonly reason?: never
}

export interface ProviderConversationNativeSearchSkipped
  extends ProviderConversationNativeSearchAdmissionBase {
  readonly kind: 'skipped'
  readonly webSearchMode: 'off'
  readonly displayState: Exclude<ProviderConversationNativeSearchDisplayState, 'requested'>
  readonly reason?: ProviderConversationNativeSearchCompatibilityReason
}

export type ProviderConversationNativeSearchAdmissionOutcome =
  | ProviderConversationNativeSearchAdmitted
  | ProviderConversationNativeSearchSkipped

export interface ProviderConversationNativeSearchAdmission {
  admit(
    input: ProviderConversationNativeSearchAdmissionInput,
  ): ProviderConversationNativeSearchAdmissionOutcome
}

/** Owns ordinary conversation native-search admission without trace or transport effects. */
export function createProviderConversationNativeSearchAdmission(
  dependencies: ProviderConversationNativeSearchAdmissionDependencies,
): ProviderConversationNativeSearchAdmission {
  return {
    admit(input) {
      const providerNativeSearchClaimed = dependencies.providerSupportsNativeSearch(input.provider)
      const nativeSearchSupported = providerNativeSearchClaimed
        && dependencies.providerSupportsNativeSearch(input.provider, input.modelConfig)
      const nativeSearchRequested = input.requestedMode === 'native'
      const reason = nativeSearchRequested && !nativeSearchSupported
        ? providerNativeSearchClaimed
          ? 'provider_native_search_model_unsupported' as const
          : 'provider_native_search_unclaimed' as const
        : undefined

      if (nativeSearchRequested && !input.hasAttachments && nativeSearchSupported) {
        return {
          kind: 'admitted',
          webSearchMode: 'native',
          requestedMode: input.requestedMode,
          nativeSearchSupported,
          displayState: 'requested',
        }
      }

      return {
        kind: 'skipped',
        webSearchMode: 'off',
        requestedMode: input.requestedMode,
        nativeSearchSupported,
        displayState: nativeSearchRequested && input.hasAttachments
          ? 'attachments_blocked'
          : 'disabled',
        ...(reason ? { reason } : {}),
      }
    },
  }
}
