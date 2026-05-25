import type { ReactNode } from 'react'
import { ScrollView, View } from 'react-native'
import { router } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import { IsleHeader, IsleIconButton } from '@/components/ui/isle'
import { IsleScreen } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'

export function SettingsPageShell({
  title,
  subtitle,
  children,
  focusKey,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  focusKey?: string
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  return (
    <IsleScreen padded={false}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 56 }}
      >
        <IsleHeader
          title={title}
          subtitle={subtitle}
          leading={
            <IsleIconButton label={t('common.back')} onPress={() => router.replace('/settings')}>
              <ChevronLeft color={colors.text} size={20} strokeWidth={2} />
            </IsleIconButton>
          }
        />
        <MotiView
          key={focusKey ?? title}
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', damping: 22, stiffness: 190 }}
          style={{ paddingTop: 16 }}
        >
          <View style={{ gap: 12 }}>
            {children}
          </View>
        </MotiView>
      </ScrollView>
    </IsleScreen>
  )
}
