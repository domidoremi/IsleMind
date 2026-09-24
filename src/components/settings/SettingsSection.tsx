import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { View } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'

export const SettingsSectionContext = createContext<{
  target?: string
  highlight?: string
  register: (id: string, node: View | null) => void
}>({ register: () => undefined })
export function useSettingsTarget() { return useContext(SettingsSectionContext).target }
export function SettingsSection({ id, children }: { id: string; children: ReactNode }) {
  const { register, highlight } = useContext(SettingsSectionContext)
  const node = useRef<View>(null)
  const { colors } = useAppTheme()
  useEffect(() => () => register(id, null), [id, register])
  return <View ref={node} collapsable={false} testID={`settings-section-${id}`} onLayout={() => register(id, node.current)} style={{ borderLeftWidth: 3, borderLeftColor: highlight === id ? colors.primary : 'transparent', paddingLeft: 5 }}>{children}</View>
}
