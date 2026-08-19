import type { PropsWithChildren } from 'react'
import { StatusBar as NativeStatusBar, View, type ViewStyle } from 'react-native'
import { SafeAreaView, type Edges } from 'react-native-safe-area-context'
import { IsleBackground, resolveBackgroundCanvas, type IsleBackgroundMode, type IsleBackgroundState } from './Background'
import { useAppTheme } from '@/hooks/useAppTheme'

interface ScreenProps extends PropsWithChildren {
  padded?: boolean
  style?: ViewStyle
  background?: IsleBackgroundMode
  backgroundState?: IsleBackgroundState
  backgroundIntensity?: number
  edges?: Edges
}

export function IsleScreen({ children, padded = true, style, background = 'default', backgroundState = 'idle', backgroundIntensity = 1, edges }: ScreenProps) {
  const { colors, isDark } = useAppTheme()
  const canvas = resolveBackgroundCanvas(colors, background)

  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: canvas }}>
      <NativeStatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={canvas}
        translucent={false}
      />
      <View
        style={[
          {
            flex: 1,
            paddingHorizontal: padded ? 16 : 0,
          },
          style,
        ]}
      >
        <IsleBackground colors={colors} mode={background} state={backgroundState} intensity={backgroundIntensity} />
        {children}
      </View>
    </SafeAreaView>
  )
}

export const Screen = IsleScreen
