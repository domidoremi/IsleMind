import { useState, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { Text } from '@/components/ui/AppText'
import { AppIcon, type AppIconName } from '@/components/ui/AppIcon'
import { IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'

/** A shared navigation treatment, not an editor: values never become controls here. */
export function SettingsNavigationRow({ title, status, icon, onPress, id, last = false, preview, tile = false }: {
  title: string; status?: string; icon: AppIconName; onPress: () => void; id: string; last?: boolean; preview?: ReactNode; tile?: boolean
}) {
  const { colors, canonicalThemeId } = useAppTheme()
  const minimal = canonicalThemeId === 'minimal'
  const editorial = canonicalThemeId === 'monet'
  const journal = canonicalThemeId === 'animal-island-ui'
  const glass = canonicalThemeId === 'liquid-glass'
  const stacked = tile && canonicalThemeId === 'material'
  const open = minimal || editorial
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  return <IslePressable testID={id} accessibilityRole="button" accessibilityLabel={[title, status].filter(Boolean).join(', ')}
    onPress={onPress} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={{ minHeight: stacked ? 124 : minimal ? 56 : editorial ? 76 : 68, flexDirection: stacked ? 'column' : 'row', alignItems: stacked ? 'flex-start' : 'center', gap: stacked ? 18 : 12,
      width: stacked ? '48%' : undefined, flexGrow: stacked ? 1 : 0,
      paddingHorizontal: open ? 2 : stacked ? 18 : 14, paddingVertical: minimal ? 10 : 14,
      borderRadius: open ? 0 : journal ? 8 : glass ? 22 : 16,
      backgroundColor: hovered || focused ? colors.ui.semantic.surface.muted : stacked ? colors.ui.semantic.surface.raised : 'transparent',
      borderWidth: 1, borderColor: focused ? colors.ui.semantic.control.focus : 'transparent' }}>
    {!editorial ? <View pointerEvents="none" style={{ width: minimal ? 22 : stacked ? 28 : 36, height: minimal ? 28 : 36,
      borderRadius: journal ? 6 : glass ? 18 : 10, borderWidth: journal ? StyleSheet.hairlineWidth : 0, borderColor: colors.ui.section.divider,
      alignItems: 'center', justifyContent: 'center', backgroundColor: open || stacked || journal ? 'transparent' : colors.ui.semantic.surface.muted }}>
      <AppIcon name={icon} color={minimal ? colors.textSecondary : colors.ui.icon.accentForeground} size={stacked ? 26 : journal ? 22 : 19} />
    </View> : null}
    <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
      <Text style={{ ...colors.design?.semantic.typography.body, ...(editorial ? colors.design?.semantic.typography.title : null), fontWeight: colors.design?.semantic.typography.label.fontWeight, color: colors.text }}>{title}</Text>
      {status ? <Text style={{ ...colors.design?.semantic.typography.caption, color: colors.textSecondary }}>{status}</Text> : null}
    </View>
    {!stacked && !minimal ? preview : null}
    <View pointerEvents="none" style={stacked ? { position: 'absolute', top: 22, right: 18 } : undefined}>
      <AppIcon name={editorial || stacked ? 'arrow-right' : 'back-next'} size={editorial ? 20 : 15} color={focused ? colors.ui.icon.accentForeground : colors.textTertiary} />
    </View>
    {!last && !stacked ? <View pointerEvents="none" style={{ position: 'absolute', left: open ? 0 : 63, right: open ? 0 : 16, bottom: 0,
      borderBottomWidth: StyleSheet.hairlineWidth, borderStyle: journal ? 'dashed' : 'solid', borderColor: colors.ui.section.divider }} /> : null}
  </IslePressable>
}
