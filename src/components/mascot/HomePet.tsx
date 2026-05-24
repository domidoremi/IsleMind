import { useState } from 'react'
import { Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native'
import { MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import { BlueCatMascot } from '@/components/mascot/BlueCatMascot'
import { PetSprite } from '@/components/mascot/PetSprite'
import type { HomePetState } from '@/components/mascot/petState'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'

interface HomePetProps {
  state: HomePetState
  compact?: boolean
  style?: StyleProp<ViewStyle>
}

export function HomePet({ state, compact = false, style }: HomePetProps) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const motion = useMotionPreference()
  const { width } = useWindowDimensions()
  const [spriteFailed, setSpriteFailed] = useState(false)
  const size = compact ? Math.min(112, Math.max(88, width * 0.26)) : Math.min(146, Math.max(106, width * 0.32))
  const showBadge = state.reason !== 'idle'
  const showSprite = motion === 'full' && !spriteFailed

  return (
    <MotiView
      accessibilityRole="image"
      accessibilityLabel={t(state.labelKey)}
      from={motion === 'full' ? { opacity: 0, translateY: 8, scale: 0.98 } : { opacity: 0 }}
      animate={{ opacity: 1, translateY: 0, scale: 1 }}
      transition={motion === 'full' ? { type: 'spring', damping: 19, stiffness: 170 } : { type: 'timing', duration: motionTokens.duration.fast }}
      style={[{ alignItems: 'center', alignSelf: 'center' }, style]}
      pointerEvents="none"
    >
      {showSprite ? (
        <PetSprite animation={state.animation} size={size} speed={state.speed} onError={() => setSpriteFailed(true)} />
      ) : (
        <BlueCatMascot size={size} mood={state.mood} speed={state.speed} loading={state.reason === 'streaming' || state.reason === 'tool' || state.reason === 'retrieval'} />
      )}
      {showBadge ? (
        <View
          style={{
            minHeight: 28,
            maxWidth: Math.min(220, width - 80),
            marginTop: -8,
            paddingHorizontal: 12,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.material.chrome,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 14, fontWeight: '900' }}>
            {t(state.labelKey)}
          </Text>
        </View>
      ) : null}
    </MotiView>
  )
}
