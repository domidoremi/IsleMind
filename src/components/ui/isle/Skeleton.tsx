import type { ReactNode } from 'react'
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native'
import { MotiView } from 'moti'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'
import { resolveThemeComponentExpression } from '@/theme/themeExpression'

export type IsleSkeletonVariant = 'text' | 'circle' | 'rect' | 'paragraph'
export type IsleSkeletonControlSize = 'small' | 'middle' | 'large'

export interface IsleSkeletonProps {
  loading?: boolean
  variant?: IsleSkeletonVariant
  active?: boolean
  rows?: number
  width?: DimensionValue
  rowWidths?: DimensionValue[]
  height?: DimensionValue
  children?: ReactNode
  style?: StyleProp<ViewStyle>
}

const paragraphWidths: DimensionValue[] = ['100%', '92%', '84%', '76%', '68%']

export function IsleSkeleton({
  loading = true,
  variant = 'text',
  active = true,
  rows = 3,
  width,
  rowWidths,
  height,
  children,
  style,
}: IsleSkeletonProps) {
  const { colors, canonicalThemeId } = useAppTheme()
  const motion = useMotionPreference()

  if (!loading) return <>{children}</>

  const animated = active && motion === 'full'
  const expression = resolveThemeComponentExpression(canonicalThemeId, 'skeleton')
  const grammar = expression.motion
  const skeletonColor = colors.ui.semantic.surface.muted
  const highlightColor = colors.ui.icon.accentBackground
  const skeleton = (itemStyle: StyleProp<ViewStyle>, key?: number) => (
    <View key={key} style={itemStyle}>
      <MotiView
        testID={key === undefined ? `theme-skeleton-${canonicalThemeId}` : undefined}
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        from={{
          opacity: animated ? grammar === 'precision' ? 0.72 : grammar === 'organic' ? 0.42 : grammar === 'material' ? 0.58 : 0.48 : 1,
          backgroundColor: skeletonColor,
          translateX: 0,
          scaleX: 1,
        }}
        animate={{
          opacity: animated ? grammar === 'precision' ? 0.92 : grammar === 'organic' ? 0.84 : grammar === 'material' ? 0.9 : 0.88 : 1,
          backgroundColor: animated && grammar !== 'precision' ? highlightColor : skeletonColor,
          translateX: animated && grammar === 'organic' ? 3 : animated && grammar === 'fluid' ? 2 : 0,
          scaleX: animated && grammar === 'material' ? 0.985 : 1,
        }}
        transition={animated
          ? {
              loop: true,
              type: 'timing',
              duration: grammar === 'precision'
                ? motionTokens.duration.slow * 2
                : grammar === 'organic'
                  ? motionTokens.duration.slow * 5
                  : grammar === 'material'
                    ? motionTokens.duration.slow * 3
                    : motionTokens.duration.slow * 4,
            }
          : { type: 'timing', duration: 1 }}
        style={{
          width: '100%',
          height: '100%',
          borderRadius: expression.shape === 'angular'
            ? 1
            : expression.shape === 'material'
              ? colors.ui.radius.controlSmall
              : expression.shape === 'capsule'
                ? 999
                : colors.ui.radius.controlLarge,
          borderWidth: grammar === 'material' ? StyleSheet.hairlineWidth : 0,
          borderColor: grammar === 'material' ? colors.ui.semantic.chrome.border : 'transparent',
          shadowColor: grammar === 'fluid' ? colors.shadowTint : undefined,
          shadowOpacity: grammar === 'fluid' ? 0.1 : 0,
          shadowRadius: grammar === 'fluid' ? 8 : 0,
          shadowOffset: { width: 0, height: 3 },
          elevation: grammar === 'fluid' ? 1 : 0,
          overflow: 'hidden',
        }}
      >
        {grammar === 'fluid' ? (
          <View style={{ position: 'absolute', top: 1, right: 10, left: 10, height: StyleSheet.hairlineWidth, backgroundColor: colors.ui.control.primaryForeground, opacity: 0.36 }} />
        ) : null}
      </MotiView>
    </View>
  )

  if (variant === 'paragraph') {
    const widths = rowWidths?.length ? rowWidths : paragraphWidths
    return (
      <View
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[{ alignSelf: 'stretch', gap: 9 }, style]}
      >
        {Array.from({ length: Math.max(1, rows) }, (_, index) => skeleton({
          width: widths[index] ?? widths[widths.length - 1] ?? '100%',
          height: typeof height === 'number' ? height : 14,
          maxWidth: '100%',
          borderRadius: expression.shape === 'angular' ? 1 : expression.shape === 'capsule' ? 999 : colors.ui.radius.controlSmall,
        }, index))}
      </View>
    )
  }

  const circleSize = width ?? height ?? 44
  const itemWidth = variant === 'circle' ? circleSize : width ?? '100%'
  const itemHeight = variant === 'circle' ? circleSize : height ?? (variant === 'rect' ? 120 : 16)
  return skeleton([
    {
      width: itemWidth,
      height: itemHeight,
      maxWidth: '100%',
      borderRadius: variant === 'circle'
        ? 999
        : expression.shape === 'angular'
          ? 1
          : expression.shape === 'capsule'
            ? 999
            : variant === 'rect'
              ? colors.ui.radius.card
              : colors.ui.radius.controlSmall,
    },
    style,
  ])
}

const controlMetrics: Record<IsleSkeletonControlSize, { button: ViewStyle; input: ViewStyle; avatar: number }> = {
  small: { button: { width: 80, height: 32 }, input: { width: 160, height: 32 }, avatar: 32 },
  middle: { button: { width: 100, height: 40 }, input: { width: 200, height: 40 }, avatar: 44 },
  large: { button: { width: 130, height: 48 }, input: { width: 240, height: 48 }, avatar: 56 },
}

export function IsleSkeletonButton({ size = 'middle', active = true, style }: { size?: IsleSkeletonControlSize; active?: boolean; style?: StyleProp<ViewStyle> }) {
  return <IsleSkeleton active={active} variant="rect" style={[controlMetrics[size].button, { borderRadius: 999 }, style]} />
}

export function IsleSkeletonInput({ size = 'middle', active = true, style }: { size?: IsleSkeletonControlSize; active?: boolean; style?: StyleProp<ViewStyle> }) {
  return <IsleSkeleton active={active} variant="rect" style={[controlMetrics[size].input, { borderRadius: 999 }, style]} />
}

export function IsleSkeletonAvatar({ size = 'middle', shape = 'circle', active = true, style }: { size?: IsleSkeletonControlSize; shape?: 'circle' | 'square'; active?: boolean; style?: StyleProp<ViewStyle> }) {
  const pixels = controlMetrics[size].avatar
  return <IsleSkeleton active={active} variant={shape === 'circle' ? 'circle' : 'rect'} width={pixels} height={pixels} style={style} />
}
