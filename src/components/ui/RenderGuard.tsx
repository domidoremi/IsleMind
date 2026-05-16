import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { AlertTriangle, Copy, RotateCcw } from 'lucide-react-native'
import { IslandButton } from '@/components/ui/IslandButton'
import { IslandPanel } from '@/components/ui/IslandPanel'
import { useAppTheme } from '@/hooks/useAppTheme'

interface RenderGuardProps {
  children: ReactNode
  label?: string
  fallbackText?: string
  compact?: boolean
}

type Palette = ReturnType<typeof useAppTheme>['colors']

interface RenderGuardBoundaryProps extends RenderGuardProps {
  colors: Palette
}

interface RenderGuardState {
  error: Error | null
}

class RenderGuardBoundary extends Component<RenderGuardBoundaryProps, RenderGuardState> {
  state: RenderGuardState = { error: null }

  static getDerivedStateFromError(error: Error): RenderGuardState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (__DEV__) {
      console.warn('[RenderGuard]', this.props.label ?? 'render', error, info.componentStack)
    }
  }

  reset = () => {
    this.setState({ error: null })
  }

  copyFallback = () => {
    const text = this.props.fallbackText || this.state.error?.message || ''
    if (!text.trim()) return
    void Clipboard.setStringAsync(text)
  }

  render() {
    if (!this.state.error) return this.props.children

    const { colors } = this.props
    const title = this.props.compact ? '内容暂时无法渲染' : `${this.props.label ?? '内容'}暂时无法渲染`
    return (
      <IslandPanel elevated={false} style={{ borderRadius: this.props.compact ? 18 : 24 }} contentStyle={{ padding: this.props.compact ? 10 : 14 }}>
        <View style={{ flexDirection: 'row', gap: 9, alignItems: 'flex-start' }}>
          <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.coralWash }}>
            <AlertTriangle color={colors.error} size={15} strokeWidth={2.1} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '900' }}>{title}</Text>
            <Text numberOfLines={this.props.compact ? 2 : 4} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 3 }}>
              已切到安全视图，不会影响继续对话。
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 }}>
              <IslandButton compact label="重试渲染" icon={<RotateCcw color={colors.textSecondary} size={13} strokeWidth={2} />} onPress={this.reset} />
              {this.props.fallbackText ? (
                <IslandButton compact label="复制原文" icon={<Copy color={colors.textSecondary} size={13} strokeWidth={2} />} onPress={this.copyFallback} />
              ) : null}
            </View>
          </View>
        </View>
      </IslandPanel>
    )
  }
}

export function RenderGuard(props: RenderGuardProps) {
  const { colors } = useAppTheme()
  return <RenderGuardBoundary {...props} colors={colors} />
}
