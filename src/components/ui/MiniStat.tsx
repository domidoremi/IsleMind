import { Text, View } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'

export function MiniStat({ label }: { label: string }) {
  const { colors } = useAppTheme()
  return (
    <View style={{ minHeight: 30, borderRadius: 15, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.islandRaised, borderWidth: 1, borderColor: colors.border }}>
      <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900' }}>{label}</Text>
    </View>
  )
}
