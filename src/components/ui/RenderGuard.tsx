import { Component, type ErrorInfo, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { Text } from '@/components/ui/AppText'
import * as Clipboard from 'expo-clipboard'
import { useTranslation } from 'react-i18next'
import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import { IsleButton } from '@/components/ui/isle'
import { IslePanel } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { logRenderError } from '@/services/runtimeHealthLog'
import { useActionFeedback } from '@/hooks/useActionFeedback'
import { ActionFeedback } from './ActionFeedback'

interface RenderGuardProps {
  children: ReactNode
  label?: string
  fallbackText?: string
  compact?: boolean
}

type Palette = ReturnType<typeof useAppTheme>['colors']

interface RenderGuardBoundaryProps extends RenderGuardProps {
  colors: Palette
  strings: {
    content: string
    compactTitle: string
    titleSuffix: string
    description: string
    retryRender: string
    copyRaw: string
  }
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
    void logRenderError({
      label: this.props.label,
      compact: this.props.compact,
      fallbackText: this.props.fallbackText,
      componentStack: info.componentStack ?? undefined,
      error,
    })
    if (__DEV__) {
      console.warn('[RenderGuard]', this.props.label ?? 'render', error, info.componentStack)
    }
  }

  reset = () => {
    this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children

    const { colors, strings } = this.props
    const subtleBorderWidth = colors.ui.monet ? 1 : StyleSheet.hairlineWidth
    const title = this.props.compact ? strings.compactTitle : `${this.props.label ?? strings.content}${strings.titleSuffix}`
    return (
      <IslePanel elevated={false} style={{ borderRadius: this.props.compact ? colors.ui.radius.card : colors.ui.radius.panel }} contentStyle={{ padding: this.props.compact ? 10 : 14 }}>
        <View style={{ flexDirection: 'row', gap: 9, alignItems: 'flex-start' }}>
          <View style={{ width: 28, height: 28, borderRadius: colors.ui.radius.controlSmall, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.tone.danger.background, borderWidth: subtleBorderWidth, borderColor: colors.ui.tone.danger.border }}>
            <AppIcon name="warning" color={colors.ui.tone.danger.foreground} size={15} strokeWidth={appIconStroke.strong} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '800' }}>{title}</Text>
            <Text numberOfLines={this.props.compact ? 2 : 4} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 3 }}>
              {strings.description}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 }}>
              <IsleButton compact label={strings.retryRender} icon={<AppIcon name="retry" color={colors.textSecondary} size={13} />} onPress={this.reset} />
              {this.props.fallbackText?.trim() ? (
                <RenderGuardCopyAction text={this.props.fallbackText} label={strings.copyRaw} />
              ) : null}
            </View>
          </View>
        </View>
      </IslePanel>
    )
  }
}

function RenderGuardCopyAction({ text, label }: { text: string; label: string }) {
  const { t } = useTranslation()
  const { colors } = useAppTheme()
  const feedback = useActionFeedback(text)
  const pending = feedback.phase === 'pending'
  const copied = feedback.phase === 'success'
  return <View style={{ minWidth: 0, flexShrink: 1, alignItems: 'flex-start' }}>
    <IsleButton compact testID="render-guard-copy" label={copied ? t('common.copied') : label}
      icon={<AppIcon name={copied ? 'check' : 'copy'} color={colors.textSecondary} size={13} />}
      busy={pending} disabled={pending} onPress={() => void feedback.run(async () => await Clipboard.setStringAsync(text) === true)} />
    <ActionFeedback testID="render-guard-copy-feedback" phase={feedback.phase} errorLabel={t('common.copyFailed')} />
  </View>
}

export function RenderGuard(props: RenderGuardProps) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  return (
    <RenderGuardBoundary
      {...props}
      colors={colors}
      strings={{
        content: t('renderGuard.content'),
        compactTitle: t('renderGuard.compactTitle'),
        titleSuffix: t('renderGuard.titleSuffix'),
        description: t('renderGuard.description'),
        retryRender: t('renderGuard.retryRender'),
        copyRaw: t('renderGuard.copyRaw'),
      }}
    />
  )
}
