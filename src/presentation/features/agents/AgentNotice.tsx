import type { ReactNode } from 'react'
import { View } from 'react-native'
import { Text } from '@/components/ui/AppText'
import { IsleChip, IslePanel } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { FeedbackGlyph } from '@/components/ui/FeedbackGlyph'
import type { AgentTone } from './agentRunPresentation'

/** Theme-owned surface (Liquid Glass uses GlassSurface through IslePanel); tone is carried by the chip, not a custom fill. */
export function AgentNotice({ tone, label, title, body, alert = false, pending = false, children, testID }: {
  tone: AgentTone; label: string; title?: string; body?: string; alert?: boolean; pending?: boolean; children?: ReactNode; testID?: string
}) {
  const { colors } = useAppTheme()
  return <IslePanel material={alert ? 'paper' : 'transparent'} contentStyle={{ padding: alert ? 14 : 4, gap: 12 }}>
    <View testID={testID} accessibilityRole={alert ? 'alert' : 'summary'} accessibilityState={{ busy: pending }} style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <IsleChip tone={tone}>{label}</IsleChip>
        {pending ? <FeedbackGlyph phase="pending" label={label} /> : null}
        {title ? <Text style={{ flexShrink: 1, color: colors.text, fontSize: 15, lineHeight: 21, fontWeight: '700' }}>{title}</Text> : null}
      </View>
      {body ? <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 21 }}>{body}</Text> : null}
    </View>
    {children}
  </IslePanel>
}
