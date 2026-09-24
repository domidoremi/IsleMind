import type { PropsWithChildren } from 'react'
import { StatusBar as NativeStatusBar, StyleSheet, View, type ViewStyle } from 'react-native'
import { SafeAreaView, type Edges } from 'react-native-safe-area-context'
import { IsleBackground, resolveBackgroundCanvas, type IsleBackgroundMode, type IsleBackgroundState } from './Background'
import { useAppTheme } from '@/hooks/useAppTheme'
import { GlassBackdropProvider, GlassBackdropTarget } from './GlassSurface'

interface ScreenProps extends PropsWithChildren {
  padded?: boolean
  style?: ViewStyle
  background?: IsleBackgroundMode
  backgroundState?: IsleBackgroundState
  backgroundIntensity?: number
  edges?: Edges
}

export function IsleScreen({ children, padded = true, style, background = 'default', backgroundState = 'idle', backgroundIntensity = 1, edges }: ScreenProps) {
  const { colors, isDark, isLiquidGlass, backgroundEnvironment } = useAppTheme()
  const canvas = resolveBackgroundCanvas(colors, background)

  return (
    <GlassBackdropProvider enabled={isLiquidGlass}>
      <View style={{ flex: 1, backgroundColor: canvas }}>
        <NativeStatusBar
          barStyle={isDark ? 'light-content' : 'dark-content'}
          backgroundColor="transparent"
          translucent
        />
        {/* The canvas covers system-bar insets; only interactive content is inset.
            Keep the glass target before, and separate from, its consuming surfaces. */}
        {isLiquidGlass ? (
          <GlassBackdropTarget pointerEvents="none" style={StyleSheet.absoluteFill}>
            <IsleBackground colors={colors} environment={backgroundEnvironment} mode={background} state={backgroundState} intensity={backgroundIntensity} />
          </GlassBackdropTarget>
        ) : <IsleBackground colors={colors} environment={backgroundEnvironment} mode={background} state={backgroundState} intensity={backgroundIntensity} />}
        <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: 'transparent' }}>
          <View
            style={[
              {
                flex: 1,
                paddingHorizontal: padded ? 16 : 0,
              },
              style,
            ]}
          >
            {children}
          </View>
        </SafeAreaView>
      </View>
    </GlassBackdropProvider>
  )
}

export const Screen = IsleScreen
