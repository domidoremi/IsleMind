import type { OnboardingCompanionMode, RagProfile, ReasoningEffort, Settings } from '@/types'

export interface OnboardingCompanionProfile {
  mode: OnboardingCompanionMode
  systemPrompt: string
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
    systemPrompt: [
      'Answer directly and keep the result easy to act on.',
      'Prefer concrete next steps, short tradeoffs, and crisp decisions.',
      'Ask at most one clarifying question when the task is blocked.',
    ].join(' '),
    temperature: 0.3,
    reasoningEffort: 'low',
    ragProfile: 'fast',
    knowledgeTopK: 3,
    memoryTopK: 2,
  },
  research: {
    mode: 'research',
    systemPrompt: [
      'Act as a careful research partner.',
      'Separate evidence from inference, surface uncertainty, and use available knowledge, memory, and search context before answering.',
      'When sources are provided, cite them instead of relying on unstated assumptions.',
    ].join(' '),
    temperature: 0.5,
    reasoningEffort: 'high',
    ragProfile: 'deep',
    knowledgeTopK: 6,
    memoryTopK: 4,
  },
  creative: {
    mode: 'creative',
    systemPrompt: [
      'Act as an exploratory creative partner.',
      'Offer varied options, preserve the user constraints, and turn loose ideas into usable drafts or prototypes.',
      'Keep momentum by proposing a strong first version before polishing.',
    ].join(' '),
    temperature: 0.9,
    reasoningEffort: 'medium',
    ragProfile: 'balanced',
    knowledgeTopK: 4,
    memoryTopK: 3,
  },
  engineering: {
    mode: 'engineering',
    systemPrompt: [
      'Act as a senior engineering partner.',
      'Prioritize reproducible steps, risk controls, implementation details, and verification evidence.',
      'Keep recommendations scoped to the actual system and call out assumptions that could break the plan.',
    ].join(' '),
    temperature: 0.35,
    reasoningEffort: 'high',
    ragProfile: 'deep',
    knowledgeTopK: 6,
    memoryTopK: 4,
  },
  companion: {
    mode: 'companion',
    systemPrompt: [
      'Act as a steady productivity companion.',
      'Help the user clarify intent, keep momentum, remember preferences when available, and convert discussion into concrete next actions.',
      'Balance warmth with useful structure.',
    ].join(' '),
    temperature: 0.75,
    reasoningEffort: 'medium',
    ragProfile: 'balanced',
    knowledgeTopK: 4,
    memoryTopK: 6,
  },
}

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
    systemPrompt: profile.systemPrompt,
    temperature: profile.temperature,
    reasoningEffort: profile.reasoningEffort,
  }
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
