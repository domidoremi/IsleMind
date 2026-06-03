import { useEffect, useMemo, useState } from 'react'
import { BackHandler, Image, Text, View, useWindowDimensions } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Circle, Defs, G, LinearGradient, Path, Stop } from 'react-native-svg'
import { AnimatePresence, MotiView } from 'moti'
import { BrainCircuit, Check, Compass, LockKeyhole, MessageCircle, Search, SendHorizontal, ShieldCheck, Sparkles } from 'lucide-react-native'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'
import type { OnboardingCompanionMode } from '@/types'
import { DEFAULT_ONBOARDING_COMPANION_MODE } from '@/utils/onboardingProfile'

export interface OnboardingCompleteInput {
  draft?: string
  companionMode: OnboardingCompanionMode
}

interface OnboardingFlowProps {
  onComplete: (input: OnboardingCompleteInput) => void
  onSkip: () => void
}

type StageId = 'awaken' | 'privacy' | 'companion' | 'capability' | 'firstPrompt'
type StageTone = 'mint' | 'sky' | 'amber' | 'coral' | 'ink'

interface OnboardingStage {
  id: StageId
  eyebrowKey: string
  titleKey: string
  bodyKey: string
  actionKey: string
  tone: StageTone
}

interface CompanionOption {
  id: OnboardingCompanionMode
  labelKey: string
  bodyKey: string
  promptKey: string
  tone: StageTone
}

const mark = require('../../../assets/splash-icon.png')

const STAGES: OnboardingStage[] = [
  {
    id: 'awaken',
    eyebrowKey: 'onboarding.awaken.eyebrow',
    titleKey: 'onboarding.awaken.title',
    bodyKey: 'onboarding.awaken.body',
    actionKey: 'onboarding.awaken.action',
    tone: 'mint',
  },
  {
    id: 'privacy',
    eyebrowKey: 'onboarding.privacy.eyebrow',
    titleKey: 'onboarding.privacy.title',
    bodyKey: 'onboarding.privacy.body',
    actionKey: 'onboarding.privacy.action',
    tone: 'sky',
  },
  {
    id: 'companion',
    eyebrowKey: 'onboarding.companion.eyebrow',
    titleKey: 'onboarding.companion.title',
    bodyKey: 'onboarding.companion.body',
    actionKey: 'onboarding.companion.action',
    tone: 'amber',
  },
  {
    id: 'capability',
    eyebrowKey: 'onboarding.capability.eyebrow',
    titleKey: 'onboarding.capability.title',
    bodyKey: 'onboarding.capability.body',
    actionKey: 'onboarding.capability.action',
    tone: 'coral',
  },
  {
    id: 'firstPrompt',
    eyebrowKey: 'onboarding.firstPrompt.eyebrow',
    titleKey: 'onboarding.firstPrompt.title',
    bodyKey: 'onboarding.firstPrompt.body',
    actionKey: 'onboarding.firstPrompt.action',
    tone: 'mint',
  },
]

const COMPANIONS: CompanionOption[] = [
  {
    id: 'concise',
    labelKey: 'onboarding.companion.modes.concise.title',
    bodyKey: 'onboarding.companion.modes.concise.body',
    promptKey: 'onboarding.firstPrompt.samples.concise',
    tone: 'mint',
  },
  {
    id: 'research',
    labelKey: 'onboarding.companion.modes.research.title',
    bodyKey: 'onboarding.companion.modes.research.body',
    promptKey: 'onboarding.firstPrompt.samples.research',
    tone: 'sky',
  },
  {
    id: 'creative',
    labelKey: 'onboarding.companion.modes.creative.title',
    bodyKey: 'onboarding.companion.modes.creative.body',
    promptKey: 'onboarding.firstPrompt.samples.creative',
    tone: 'amber',
  },
  {
    id: 'engineering',
    labelKey: 'onboarding.companion.modes.engineering.title',
    bodyKey: 'onboarding.companion.modes.engineering.body',
    promptKey: 'onboarding.firstPrompt.samples.engineering',
    tone: 'ink',
  },
  {
    id: 'companion',
    labelKey: 'onboarding.companion.modes.companion.title',
    bodyKey: 'onboarding.companion.modes.companion.body',
    promptKey: 'onboarding.firstPrompt.samples.companion',
    tone: 'coral',
  },
]

const DEFAULT_COMPANION = COMPANIONS.find((item) => item.id === DEFAULT_ONBOARDING_COMPANION_MODE) ?? COMPANIONS[0]

const BEACONS = [
  { id: 'chat', titleKey: 'onboarding.privacy.beacons.chat.title', bodyKey: 'onboarding.privacy.beacons.chat.body', icon: MessageCircle },
  { id: 'key', titleKey: 'onboarding.privacy.beacons.key.title', bodyKey: 'onboarding.privacy.beacons.key.body', icon: LockKeyhole },
  { id: 'knowledge', titleKey: 'onboarding.privacy.beacons.knowledge.title', bodyKey: 'onboarding.privacy.beacons.knowledge.body', icon: ShieldCheck },
] as const

const CAPABILITIES = [
  { id: 'knowledge', titleKey: 'onboarding.capability.items.knowledge.title', bodyKey: 'onboarding.capability.items.knowledge.body', icon: BrainCircuit },
  { id: 'memory', titleKey: 'onboarding.capability.items.memory.title', bodyKey: 'onboarding.capability.items.memory.body', icon: Sparkles },
  { id: 'search', titleKey: 'onboarding.capability.items.search.title', bodyKey: 'onboarding.capability.items.search.body', icon: Search },
  { id: 'skills', titleKey: 'onboarding.capability.items.skills.title', bodyKey: 'onboarding.capability.items.skills.body', icon: Compass },
] as const

export function OnboardingFlow({ onComplete, onSkip }: OnboardingFlowProps) {
  const { colors, isDark } = useAppTheme()
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const motion = useMotionPreference()
  const { width, height } = useWindowDimensions()
  const [stageIndex, setStageIndex] = useState(0)
  const [litBeacons, setLitBeacons] = useState<Set<string>>(() => new Set())
  const [companionMode, setCompanionMode] = useState<OnboardingCompanionMode>(DEFAULT_ONBOARDING_COMPANION_MODE)
  const [selectedPromptKey, setSelectedPromptKey] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)
  const stage = STAGES[stageIndex]
  const selectedCompanion = COMPANIONS.find((item) => item.id === companionMode) ?? DEFAULT_COMPANION
  const tone = toneColors(stage.id === 'companion' ? selectedCompanion.tone : stage.tone, colors)
  const progress = (stageIndex + 1) / STAGES.length
  const compact = height < 680 || width < 370

  const promptOptions = useMemo(() => {
    const companion = COMPANIONS.find((item) => item.id === companionMode) ?? DEFAULT_COMPANION
    return [
      companion.promptKey,
      'onboarding.firstPrompt.samples.organize',
      'onboarding.firstPrompt.samples.plan',
    ]
  }, [companionMode])

  useEffect(() => {
    if (selectedPromptKey && !promptOptions.includes(selectedPromptKey)) {
      setSelectedPromptKey(null)
    }
  }, [promptOptions, selectedPromptKey])

  function complete(draft?: string) {
    if (leaving) return
    setLeaving(true)
    setTimeout(() => {
      onComplete({ draft, companionMode })
    }, motion === 'full' ? 360 : 40)
  }

  function goNext() {
    if (leaving) return
    if (stage.id === 'firstPrompt') {
      complete(selectedPromptKey ? t(selectedPromptKey) : undefined)
      return
    }
    setStageIndex((index) => Math.min(index + 1, STAGES.length - 1))
  }

  function goBack() {
    if (leaving) return
    setStageIndex((index) => Math.max(0, index - 1))
  }

  function skip() {
    if (leaving) return
    setLeaving(true)
    setTimeout(onSkip, motion === 'full' ? 220 : 20)
  }

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (leaving) return true
      if (stageIndex > 0) {
        setStageIndex((index) => Math.max(0, index - 1))
      } else {
        skip()
      }
      return true
    })
    return () => subscription.remove()
  }, [leaving, stageIndex])

  return (
    <AnimatePresence>
        <MotiView
          from={{ opacity: 0 }}
          animate={{
            opacity: leaving ? (stage.id === 'firstPrompt' ? 0.94 : 0.82) : 1,
            scale: leaving && motion === 'full' ? 0.985 : 1,
          }}
          exit={{ opacity: 0, scale: motion === 'full' ? 0.985 : 1 }}
          transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.normal : motionTokens.duration.fast }}
          accessibilityViewIsModal
          importantForAccessibility="yes"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            zIndex: 80,
            backgroundColor: colors.material.canvas,
          }}
        >
          <OnboardingBackdrop
            width={width}
            height={height}
            progress={progress}
            tone={tone}
            colors={colors}
            dark={isDark}
            motionFull={motion === 'full'}
          />
          {leaving && stage.id === 'firstPrompt' ? (
            <ComposerLandingRibbon
              tone={tone}
              compact={compact}
              motionFull={motion === 'full'}
              bottomInset={insets.bottom}
            />
          ) : null}
          <View
            style={{
              flex: 1,
              paddingTop: Math.max(insets.top + 12, 28),
              paddingBottom: Math.max(insets.bottom + 12, 24),
              paddingHorizontal: compact ? 16 : 22,
            }}
          >
            <TopBar
              colors={colors}
              current={stageIndex}
              total={STAGES.length}
              onBack={stageIndex ? goBack : undefined}
              onSkip={skip}
              skipLabel={t('onboarding.skip')}
              backLabel={t('common.back')}
            />
            <View style={{ flex: 1, justifyContent: 'space-between', paddingTop: compact ? 8 : 14 }}>
              <MotiView
                key={stage.id}
                from={motion === 'full' ? { opacity: 0, translateY: 18, scale: 0.99 } : { opacity: 0 }}
                animate={{ opacity: 1, translateY: 0, scale: 1 }}
                transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.gentle } : { type: 'timing', duration: motionTokens.duration.fast }}
                style={{ alignItems: 'center' }}
              >
                <HeroStage
                  stage={stage}
                  companion={selectedCompanion}
                  tone={tone}
                  compact={compact}
                  progress={progress}
                  motionFull={motion === 'full'}
                />
                <Text style={{ color: tone.primary, fontSize: 12, lineHeight: 16, fontWeight: '900', marginTop: compact ? 8 : 12 }}>
                  {t(stage.eyebrowKey)}
                </Text>
                <Text
                  style={{
                    color: colors.text,
                    fontSize: compact ? 28 : 31,
                    lineHeight: compact ? 34 : 38,
                    fontWeight: '900',
                    textAlign: 'center',
                    marginTop: 8,
                    maxWidth: compact ? 316 : 344,
                  }}
                >
                  {t(stage.titleKey)}
                </Text>
                <Text
                  style={{
                    color: colors.textSecondary,
                    fontSize: compact ? 13 : 14,
                    lineHeight: compact ? 19 : 21,
                    fontWeight: '700',
                    textAlign: 'center',
                    marginTop: 10,
                    maxWidth: 344,
                  }}
                >
                  {t(stage.bodyKey)}
                </Text>
              </MotiView>
              <View style={{ minHeight: compact ? 184 : 230, justifyContent: 'center', paddingVertical: compact ? 8 : 14 }}>
                {stage.id === 'privacy' ? (
                  <PrivacyStep lit={litBeacons} onToggle={(id) => setLitBeacons((items) => toggleSet(items, id))} tone={tone} compact={compact} />
                ) : stage.id === 'companion' ? (
                  <CompanionStep selected={companionMode} onSelect={setCompanionMode} tone={tone} compact={compact} />
                ) : stage.id === 'capability' ? (
                  <CapabilityStep tone={tone} compact={compact} />
                ) : stage.id === 'firstPrompt' ? (
                  <FirstPromptStep options={promptOptions} selectedKey={selectedPromptKey} onSelect={setSelectedPromptKey} tone={tone} compact={compact} />
                ) : (
                  <AwakenStep tone={tone} compact={compact} />
                )}
              </View>
              <View style={{ gap: 12 }}>
                <LightPath
                  stageIndex={stageIndex}
                  total={STAGES.length}
                  tone={tone}
                  compact={compact}
                  motionFull={motion === 'full'}
                  onCompleteNode={goNext}
                />
                <IslePressable
                  haptic
                  onPress={goNext}
                  accessibilityLabel={t(stage.actionKey)}
                  style={{
                    minHeight: 54,
                    borderRadius: 27,
                    paddingHorizontal: 18,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                    backgroundColor: tone.primary,
                    shadowColor: tone.primary,
                    shadowOpacity: 0.24,
                    shadowRadius: 18,
                    shadowOffset: { width: 0, height: 10 },
                    elevation: 4,
                  }}
                >
                  <Text style={{ color: colors.primaryForeground, fontSize: 15, lineHeight: 18, fontWeight: '900' }}>
                    {t(stage.actionKey)}
                  </Text>
                  {stage.id === 'firstPrompt'
                    ? <SendHorizontal color={colors.primaryForeground} size={17} strokeWidth={2.2} />
                    : <Check color={colors.primaryForeground} size={17} strokeWidth={2.2} />}
                </IslePressable>
                {stage.id === 'capability' ? (
                  <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, textAlign: 'center', fontWeight: '800' }}>
                    {t('onboarding.capability.providerLater')}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>
        </MotiView>
    </AnimatePresence>
  )
}

function TopBar({
  colors,
  current,
  total,
  onBack,
  onSkip,
  skipLabel,
  backLabel,
}: {
  colors: ReturnType<typeof useAppTheme>['colors']
  current: number
  total: number
  onBack?: () => void
  onSkip: () => void
  skipLabel: string
  backLabel: string
}) {
  return (
    <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <IslePressable
        haptic
        disabled={!onBack}
        onPress={onBack}
        accessibilityElementsHidden={!onBack}
        importantForAccessibility={onBack ? 'auto' : 'no-hide-descendants'}
        accessibilityLabel={backLabel}
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: onBack ? colors.material.chrome : 'transparent',
          opacity: onBack ? 1 : 0,
        }}
      >
        <Text style={{ color: colors.textSecondary, fontSize: 18, lineHeight: 22, fontWeight: '900' }}>‹</Text>
      </IslePressable>
      <View style={{ flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center' }}>
        {Array.from({ length: total }).map((_, index) => (
          <View
            key={index}
            style={{
              width: index === current ? 28 : 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: index <= current ? colors.primary : colors.borderStrong,
            }}
          />
        ))}
      </View>
      <IslePressable
        haptic
        onPress={onSkip}
        accessibilityLabel={skipLabel}
        style={{
          minWidth: 62,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 12,
          backgroundColor: colors.material.chrome,
        }}
      >
        <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 16, fontWeight: '900' }}>{skipLabel}</Text>
      </IslePressable>
    </View>
  )
}

function HeroStage({
  stage,
  companion,
  tone,
  compact,
  progress,
  motionFull,
}: {
  stage: OnboardingStage
  companion: CompanionOption
  tone: ToneColors
  compact: boolean
  progress: number
  motionFull: boolean
}) {
  const { colors } = useAppTheme()
  const activeTone = stage.id === 'companion' ? companion.tone : stage.tone
  const badgeSize = compact ? 54 : 62
  const stageWidth = compact ? 260 : 310
  const stageHeight = compact ? 132 : 158
  const ringSize = compact ? 156 : 184
  const markSize = compact ? 122 : 140
  const orbitSize = compact ? 204 : 238
  return (
    <View style={{ height: stageHeight, alignItems: 'center', justifyContent: 'center' }}>
      <MotiView
        animate={motionFull ? { scale: [1, 1.035, 1], rotate: ['-1deg', '1deg', '-1deg'] } : { scale: 1, rotate: '0deg' }}
        transition={motionFull ? { loop: true, type: 'timing', duration: 3600 } : { type: 'timing', duration: 1 }}
        style={{
          position: 'absolute',
          width: ringSize,
          height: ringSize,
          borderRadius: ringSize / 2,
          borderWidth: 1,
          borderColor: tone.line,
          opacity: 0.82,
        }}
      />
      <MotiView
        animate={motionFull ? { opacity: [0.18, 0.42, 0.18], scale: [0.98, 1.04, 0.98] } : { opacity: 0.24, scale: 1 }}
        transition={motionFull ? { loop: true, type: 'timing', duration: 4200 } : { type: 'timing', duration: 1 }}
        style={{
          position: 'absolute',
          width: orbitSize,
          height: orbitSize * 0.62,
          borderRadius: orbitSize,
          borderWidth: 1,
          borderColor: tone.primary,
          transform: [{ rotate: '-8deg' }],
        }}
      />
      <View style={{ width: stageWidth, height: stageHeight, alignItems: 'center', justifyContent: 'center' }}>
        <MotiView
          animate={motionFull ? { scale: [1, 1.025, 1] } : { scale: 1 }}
          transition={motionFull ? { loop: true, type: 'timing', duration: 3200 } : { type: 'timing', duration: 1 }}
          style={{
            width: markSize,
            height: markSize,
            borderRadius: markSize / 2,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.material.chrome,
            borderWidth: 1,
            borderColor: tone.line,
          }}
        >
          <Image source={mark} resizeMode="contain" style={{ width: markSize * 1.12, height: markSize * 1.12 }} />
        </MotiView>
        <MotiView
          animate={motionFull ? { translateY: [-2, -6, -2], opacity: [0.82, 1, 0.82] } : { translateY: 0, opacity: 1 }}
          transition={motionFull ? { loop: true, type: 'timing', duration: 2800 } : { type: 'timing', duration: 1 }}
          style={{
            position: 'absolute',
            top: compact ? 4 : 6,
            right: compact ? 24 : 32,
            width: badgeSize,
            height: badgeSize,
            borderRadius: badgeSize / 2,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: tone.wash,
            borderWidth: 1,
            borderColor: tone.line,
          }}
        >
          <Sparkles color={activeTone === 'ink' ? tone.primary : tone.primary} size={badgeSize * 0.34} strokeWidth={2.25} />
        </MotiView>
        <View
          style={{
            position: 'absolute',
            left: compact ? 28 : 36,
            bottom: compact ? 28 : 34,
            width: compact ? 66 : 82,
            height: compact ? 3 : 4,
            borderRadius: 999,
            backgroundColor: tone.primary,
            opacity: 0.22,
          }}
        />
      </View>
      <View
        style={{
          position: 'absolute',
          bottom: compact ? 6 : 8,
          width: 54,
          height: 6,
          borderRadius: 3,
          backgroundColor: tone.primary,
          opacity: Math.max(0.32, progress * 0.8),
        }}
      />
    </View>
  )
}

function AwakenStep({ tone, compact }: { tone: ToneColors; compact: boolean }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  return (
    <View style={{ gap: compact ? 8 : 10 }}>
      {['local', 'private', 'ready'].map((id, index) => (
        <MotiView
          key={id}
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', ...motionTokens.spring.gentle, delay: index * 45 }}
          style={{
            minHeight: 42,
            borderRadius: 21,
            paddingHorizontal: 14,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            backgroundColor: colors.material.chrome,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: tone.primary }} />
          <Text style={{ flex: 1, color: colors.textSecondary, fontSize: 12, lineHeight: 16, fontWeight: '900' }}>
            {t(`onboarding.awaken.signals.${id}`)}
          </Text>
        </MotiView>
      ))}
    </View>
  )
}

function PrivacyStep({ lit, onToggle, tone, compact }: { lit: Set<string>; onToggle: (id: string) => void; tone: ToneColors; compact: boolean }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  return (
    <View style={{ gap: compact ? 8 : 10 }}>
      {BEACONS.map((item, index) => {
        const Icon = item.icon
        const active = lit.has(item.id)
        return (
          <MotiView
            key={item.id}
            from={{ opacity: 0, translateX: -12 }}
            animate={{ opacity: 1, translateX: 0 }}
            transition={{ type: 'spring', ...motionTokens.spring.gentle, delay: index * 50 }}
          >
            <IslePressable
              haptic
              onPress={() => onToggle(item.id)}
              accessibilityLabel={t(item.titleKey)}
              style={{
                minHeight: compact ? 54 : 62,
                borderRadius: 24,
                paddingHorizontal: 13,
                paddingVertical: 10,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                backgroundColor: active ? tone.wash : colors.material.chrome,
                borderWidth: 1,
                borderColor: active ? tone.primary : colors.border,
              }}
            >
              <View style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? tone.primary : colors.islandRaised }}>
                <Icon color={active ? colors.primaryForeground : colors.textSecondary} size={17} strokeWidth={2.2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 13, lineHeight: 17, fontWeight: '900' }}>{t(item.titleKey)}</Text>
                <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 15, fontWeight: '700', marginTop: 2 }}>
                  {t(item.bodyKey)}
                </Text>
              </View>
              {active ? <Check color={tone.primary} size={18} strokeWidth={2.4} /> : null}
            </IslePressable>
          </MotiView>
        )
      })}
    </View>
  )
}

function CompanionStep({ selected, onSelect, tone, compact }: { selected: OnboardingCompanionMode; onSelect: (mode: OnboardingCompanionMode) => void; tone: ToneColors; compact: boolean }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  return (
    <View style={{ gap: compact ? 8 : 10 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
        {COMPANIONS.map((item) => {
          const active = item.id === selected
          return (
            <IslePressable
              key={item.id}
              haptic
              onPress={() => onSelect(item.id)}
              accessibilityLabel={t(item.labelKey)}
              style={{
                minHeight: 44,
                borderRadius: 22,
                paddingHorizontal: 13,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: active ? tone.primary : colors.material.chrome,
                borderWidth: 1,
                borderColor: active ? tone.primary : colors.border,
              }}
            >
              <Text style={{ color: active ? colors.primaryForeground : colors.textSecondary, fontSize: 12, lineHeight: 16, fontWeight: '900' }}>
                {t(item.labelKey)}
              </Text>
            </IslePressable>
          )
        })}
      </View>
      <View style={{ minHeight: compact ? 74 : 86, borderRadius: 26, padding: 14, justifyContent: 'center', backgroundColor: colors.material.chrome, borderWidth: 1, borderColor: colors.border }}>
        <Text style={{ color: colors.text, fontSize: 14, lineHeight: 18, fontWeight: '900' }}>
          {t(COMPANIONS.find((item) => item.id === selected)?.labelKey ?? COMPANIONS[1].labelKey)}
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '700', marginTop: 5 }}>
          {t(COMPANIONS.find((item) => item.id === selected)?.bodyKey ?? COMPANIONS[1].bodyKey)}
        </Text>
      </View>
    </View>
  )
}

function CapabilityStep({ tone, compact }: { tone: ToneColors; compact: boolean }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9, justifyContent: 'center' }}>
      {CAPABILITIES.map((item, index) => {
        const Icon = item.icon
        return (
          <MotiView
            key={item.id}
            from={{ opacity: 0, scale: 0.96, translateY: 8 }}
            animate={{ opacity: 1, scale: 1, translateY: 0 }}
            transition={{ type: 'spring', ...motionTokens.spring.gentle, delay: index * 42 }}
            style={{
              width: compact ? '47%' : '46%',
              minHeight: compact ? 78 : 92,
              borderRadius: 24,
              padding: 12,
              backgroundColor: colors.material.chrome,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: tone.wash }}>
              <Icon color={tone.primary} size={16} strokeWidth={2.2} />
            </View>
            <Text style={{ color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: '900', marginTop: 8 }}>{t(item.titleKey)}</Text>
            <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 10, lineHeight: 14, fontWeight: '700', marginTop: 3 }}>{t(item.bodyKey)}</Text>
          </MotiView>
        )
      })}
    </View>
  )
}

function FirstPromptStep({ options, selectedKey, onSelect, tone, compact }: { options: string[]; selectedKey: string | null; onSelect: (key: string | null) => void; tone: ToneColors; compact: boolean }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  return (
    <View style={{ gap: compact ? 8 : 10 }}>
      {options.map((key, index) => {
        const active = key === selectedKey
        return (
          <MotiView
            key={key}
            from={{ opacity: 0, translateY: 12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', ...motionTokens.spring.gentle, delay: index * 48 }}
          >
            <IslePressable
              haptic
              onPress={() => onSelect(active ? null : key)}
              accessibilityLabel={t(key)}
              style={{
                minHeight: compact ? 50 : 56,
                borderRadius: 24,
                paddingHorizontal: 14,
                paddingVertical: compact ? 8 : 9,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                backgroundColor: active ? tone.wash : colors.material.chrome,
                borderWidth: 1,
                borderColor: active ? tone.primary : colors.border,
              }}
            >
              <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? tone.primary : colors.islandRaised }}>
                <SendHorizontal color={active ? colors.primaryForeground : colors.textSecondary} size={15} strokeWidth={2.2} />
              </View>
              <Text numberOfLines={2} style={{ flex: 1, color: colors.text, fontSize: 12, lineHeight: 17, fontWeight: '900' }}>{t(key)}</Text>
            </IslePressable>
          </MotiView>
        )
      })}
    </View>
  )
}

function LightPath({
  stageIndex,
  total,
  tone,
  compact,
  motionFull,
  onCompleteNode,
}: {
  stageIndex: number
  total: number
  tone: ToneColors
  compact: boolean
  motionFull: boolean
  onCompleteNode: () => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const width = useWindowDimensions().width - (compact ? 32 : 44)
  const railWidth = Math.max(260, Math.min(390, width))
  const dotX = useSharedValue((railWidth - 44) * (stageIndex / Math.max(1, total - 1)))
  const doneThreshold = railWidth - 76

  useEffect(() => {
    dotX.value = motionFull
      ? withSpring((railWidth - 44) * (stageIndex / Math.max(1, total - 1)), motionTokens.spring.settle)
      : withTiming((railWidth - 44) * (stageIndex / Math.max(1, total - 1)), { duration: 1 })
  }, [dotX, motionFull, railWidth, stageIndex, total])

  const pan = Gesture.Pan()
    .enabled(motionFull)
    .onUpdate((event) => {
      dotX.value = Math.max(0, Math.min(railWidth - 44, (railWidth - 44) * (stageIndex / Math.max(1, total - 1)) + event.translationX))
    })
    .onEnd(() => {
      if (dotX.value >= doneThreshold) {
        runOnJS(onCompleteNode)()
      }
      dotX.value = withSpring((railWidth - 44) * (stageIndex / Math.max(1, total - 1)), motionTokens.spring.settle)
    })

  const dotStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dotX.value }],
  }))

  return (
    <View style={{ alignItems: 'center', gap: 7 }}>
      <View
        style={{
          width: railWidth,
          height: 44,
          borderRadius: 22,
          padding: 5,
          justifyContent: 'center',
          backgroundColor: colors.material.chrome,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.borderStrong, overflow: 'hidden' }}>
          <View style={{ width: `${((stageIndex + 1) / total) * 100}%`, height: 6, borderRadius: 3, backgroundColor: tone.primary }} />
        </View>
        <GestureDetector gesture={pan}>
          <Animated.View
            style={[
              {
                position: 'absolute',
                left: 5,
                top: 5,
                width: 34,
                height: 34,
                borderRadius: 17,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: tone.primary,
                shadowColor: tone.primary,
                shadowOpacity: 0.28,
                shadowRadius: 10,
                shadowOffset: { width: 0, height: 5 },
                elevation: 4,
              },
              dotStyle,
            ]}
          >
            <Sparkles color={colors.primaryForeground} size={14} strokeWidth={2.2} />
          </Animated.View>
        </GestureDetector>
      </View>
      <Text style={{ color: colors.textTertiary, fontSize: 10, lineHeight: 13, fontWeight: '800', textAlign: 'center' }}>
        {motionFull ? t('onboarding.dragHint') : t('onboarding.tapHint')}
      </Text>
    </View>
  )
}

function ComposerLandingRibbon({
  tone,
  compact,
  motionFull,
  bottomInset,
}: {
  tone: ToneColors
  compact: boolean
  motionFull: boolean
  bottomInset: number
}) {
  const { colors } = useAppTheme()
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: compact ? 18 : 26,
        right: compact ? 18 : 26,
        bottom: Math.max(bottomInset + 24, 34),
        height: compact ? 96 : 116,
        alignItems: 'center',
        justifyContent: 'flex-end',
        zIndex: 3,
      }}
    >
      <MotiView
        from={{ opacity: 0, translateY: motionFull ? -90 : 0, scaleX: motionFull ? 0.25 : 1 }}
        animate={motionFull ? { opacity: [0, 0.9, 0.18], translateY: [-90, -10, 0], scaleX: [0.25, 1, 0.32] } : { opacity: 0.38, translateY: 0, scaleX: 1 }}
        transition={{ type: 'timing', duration: motionFull ? 360 : 40 }}
        style={{
          position: 'absolute',
          bottom: compact ? 46 : 54,
          width: compact ? 210 : 260,
          height: compact ? 72 : 88,
          borderRadius: 999,
          backgroundColor: tone.primary,
        }}
      />
      <MotiView
        from={{ opacity: 0, scale: motionFull ? 0.88 : 1 }}
        animate={{ opacity: motionFull ? [0, 1, 0.68] : 0.7, scale: motionFull ? [0.88, 1.04, 1] : 1 }}
        transition={{ type: 'timing', duration: motionFull ? 360 : 40 }}
        style={{
          width: '100%',
          height: compact ? 52 : 58,
          borderRadius: 29,
          backgroundColor: colors.material.chrome,
          borderWidth: 1,
          borderColor: tone.line,
          shadowColor: tone.primary,
          shadowOpacity: 0.22,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 10 },
          elevation: 5,
        }}
      />
    </View>
  )
}

function OnboardingBackdrop({
  width,
  height,
  progress,
  tone,
  colors,
  dark,
  motionFull,
}: {
  width: number
  height: number
  progress: number
  tone: ToneColors
  colors: ReturnType<typeof useAppTheme>['colors']
  dark: boolean
  motionFull: boolean
}) {
  const horizon = height * 0.44
  const skyStart = colors.material.canvas
  const skyEnd = colors.paperDeep
  const waterStart = colors.paperWarm
  const islandFill = colors.islandMuted
  const islandRaisedFill = colors.surfaceTertiary
  const decorativeOpacity = colors.ui.ornamented ? 0.68 : 0.36
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <Defs>
          <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={skyStart} stopOpacity="1" />
            <Stop offset="0.58" stopColor={tone.bg} stopOpacity={dark ? '0.42' : '0.62'} />
            <Stop offset="1" stopColor={skyEnd} stopOpacity="1" />
          </LinearGradient>
          <LinearGradient id="water" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={waterStart} stopOpacity="1" />
            <Stop offset="1" stopColor={tone.bg} stopOpacity={dark ? '0.38' : '0.72'} />
          </LinearGradient>
        </Defs>
        <Path d={`M0 0H${width}V${height}H0Z`} fill="url(#sky)" />
        <Path d={`M0 ${horizon} C ${width * 0.18} ${horizon - 18}, ${width * 0.35} ${horizon + 18}, ${width * 0.52} ${horizon} S ${width * 0.83} ${horizon - 16}, ${width} ${horizon + 8} V ${height} H0Z`} fill="url(#water)" opacity="0.76" />
        <Path d={`M${width * 0.09} ${horizon + 36} C ${width * 0.18} ${horizon + 8}, ${width * 0.36} ${horizon + 10}, ${width * 0.45} ${horizon + 38} C ${width * 0.36} ${horizon + 54}, ${width * 0.18} ${horizon + 58}, ${width * 0.09} ${horizon + 36}Z`} fill={islandFill} opacity={String(decorativeOpacity)} />
        <Path d={`M${width * 0.52} ${horizon + 64} C ${width * 0.63} ${horizon + 24}, ${width * 0.88} ${horizon + 28}, ${width * 0.96} ${horizon + 72} C ${width * 0.78} ${horizon + 92}, ${width * 0.62} ${horizon + 92}, ${width * 0.52} ${horizon + 64}Z`} fill={islandRaisedFill} opacity={String(Math.max(0.28, decorativeOpacity - 0.02))} />
        <Path d={`M${width * 0.16} ${height * 0.79} C ${width * 0.34} ${height * 0.74}, ${width * 0.56} ${height * 0.76}, ${width * 0.82} ${height * 0.69}`} stroke={tone.primary} strokeOpacity="0.26" strokeWidth="2" fill="none" />
        <G opacity={motionFull ? '0.34' : '0.16'}>
          <Circle cx={width * 0.18} cy={height * 0.18} r="1.8" fill={tone.primary} />
          <Circle cx={width * 0.72} cy={height * 0.16} r="1.4" fill={tone.primary} />
          <Circle cx={width * 0.84} cy={height * 0.31} r="1.6" fill={tone.primary} />
          <Circle cx={width * 0.31} cy={height * 0.3} r="1.2" fill={tone.primary} />
        </G>
      </Svg>
      <MotiView
        animate={motionFull ? { opacity: [0.18, 0.38, 0.18], translateX: [-16, 16, -16] } : { opacity: 0.22, translateX: 0 }}
        transition={motionFull ? { loop: true, type: 'timing', duration: 5400 } : { type: 'timing', duration: 1 }}
        style={{
          position: 'absolute',
          left: -40,
          right: -40,
          top: height * (0.18 + progress * 0.08),
          height: 2,
          backgroundColor: tone.primary,
        }}
      />
    </View>
  )
}

interface ToneColors {
  primary: string
  bg: string
  wash: string
  line: string
}

function toneColors(tone: StageTone, colors: ReturnType<typeof useAppTheme>['colors']): ToneColors {
  if (tone === 'sky') return { primary: colors.sky, bg: colors.skyWash, wash: colors.skyWash, line: colors.borderStrong }
  if (tone === 'amber') return { primary: colors.amber, bg: colors.amberWash, wash: colors.amberWash, line: colors.borderStrong }
  if (tone === 'coral') return { primary: colors.coral, bg: colors.coralWash, wash: colors.coralWash, line: colors.borderStrong }
  if (tone === 'ink') return { primary: colors.text, bg: colors.surfaceSecondary, wash: colors.surfaceSecondary, line: colors.borderStrong }
  return { primary: colors.primary, bg: colors.mintWash, wash: colors.mintWash, line: colors.borderStrong }
}

function toggleSet(items: Set<string>, id: string) {
  const next = new Set(items)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}
