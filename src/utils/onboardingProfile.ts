import type { OnboardingCompanionMode, RagProfile, ReasoningEffort, Settings } from '@/types'

export interface OnboardingCompanionProfile {
  mode: OnboardingCompanionMode
  temperature: number
  reasoningEffort: ReasoningEffort
  ragProfile: RagProfile
  knowledgeTopK: number
  memoryTopK: number
}

export interface OnboardingConversationDefaults {
  systemPrompt: string
  temperature: number
  reasoningEffort: ReasoningEffort
}

export const DEFAULT_ONBOARDING_COMPANION_MODE: OnboardingCompanionMode = 'concise'

const ONBOARDING_COMPANION_PROFILES: Record<OnboardingCompanionMode, OnboardingCompanionProfile> = {
  concise: {
    mode: 'concise',
    temperature: 0.3,
    reasoningEffort: 'low',
    ragProfile: 'fast',
    knowledgeTopK: 3,
    memoryTopK: 2,
  },
  research: {
    mode: 'research',
    temperature: 0.5,
    reasoningEffort: 'high',
    ragProfile: 'deep',
    knowledgeTopK: 6,
    memoryTopK: 4,
  },
  creative: {
    mode: 'creative',
    temperature: 0.9,
    reasoningEffort: 'medium',
    ragProfile: 'balanced',
    knowledgeTopK: 4,
    memoryTopK: 3,
  },
  engineering: {
    mode: 'engineering',
    temperature: 0.35,
    reasoningEffort: 'high',
    ragProfile: 'deep',
    knowledgeTopK: 6,
    memoryTopK: 4,
  },
  companion: {
    mode: 'companion',
    temperature: 0.75,
    reasoningEffort: 'medium',
    ragProfile: 'balanced',
    knowledgeTopK: 4,
    memoryTopK: 6,
  },
}

const LEGACY_ONBOARDING_SYSTEM_PROMPT_HASHES = new Set([0xf9888d0a, 0x57f345ce, 0xa98f9ab0, 0xbafba833, 0x24c158ad])

export function getOnboardingCompanionProfile(mode?: OnboardingCompanionMode | null): OnboardingCompanionProfile {
  const requested = mode ?? DEFAULT_ONBOARDING_COMPANION_MODE
  if (Object.prototype.hasOwnProperty.call(ONBOARDING_COMPANION_PROFILES, requested)) {
    return ONBOARDING_COMPANION_PROFILES[requested]
  }
  return ONBOARDING_COMPANION_PROFILES[DEFAULT_ONBOARDING_COMPANION_MODE]
}

export function getOnboardingConversationDefaults(mode?: OnboardingCompanionMode | null): OnboardingConversationDefaults {
  const profile = getOnboardingCompanionProfile(mode)
  return {
    systemPrompt: '',
    temperature: profile.temperature,
    reasoningEffort: profile.reasoningEffort,
  }
}

export function isOnboardingSystemPrompt(systemPrompt?: string | null): boolean {
  const normalized = systemPrompt?.trim()
  if (!normalized) return false
  return LEGACY_ONBOARDING_SYSTEM_PROMPT_HASHES.has(hashPrompt(normalized))
}

function hashPrompt(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function getOnboardingSettingsDefaults(
  mode: OnboardingCompanionMode
): Pick<Settings, 'onboardingCompanionMode' | 'defaultTemperature' | 'ragProfile' | 'knowledgeTopK' | 'memoryTopK'> {
  const profile = getOnboardingCompanionProfile(mode)
  return {
    onboardingCompanionMode: profile.mode,
    defaultTemperature: profile.temperature,
    ragProfile: profile.ragProfile,
    knowledgeTopK: profile.knowledgeTopK,
    memoryTopK: profile.memoryTopK,
  }
}
