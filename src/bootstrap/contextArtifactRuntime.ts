import {
  createContextArtifactPolicy,
  createInMemoryContextArtifactStore,
} from '@/modules/assistant-runtime'
import { estimateTextTokens } from '@/services/tokenUsage'

const store = createInMemoryContextArtifactStore()

/**
 * Session-local artifact authority shared by Chat lanes.  The policy binds
 * every read to the canonical conversation id and the pointer's authority.
 */
export const contextArtifactRuntime = createContextArtifactPolicy({
  store,
  estimateTextTokens,
  now: Date.now,
})

