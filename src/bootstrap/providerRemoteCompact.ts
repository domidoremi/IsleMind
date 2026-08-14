import { createProviderRemoteCompactPolicy } from '@/modules/providers'
import { estimateTextTokens } from '@/services/tokenUsage'

export type {
  RemoteCompactDecision,
  RemoteCompactDecisionInput,
} from '@/modules/providers'

export const providerRemoteCompactPolicy = createProviderRemoteCompactPolicy({
  estimateTextTokens,
})

export const decideRemoteCompact = providerRemoteCompactPolicy.decideRemoteCompact
