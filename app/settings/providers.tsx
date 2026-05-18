import { ScrollView, Text, View } from 'react-native'
import { ChevronLeft, Plus } from 'lucide-react-native'
import { router } from 'expo-router'
import { Screen } from '@/components/ui/Screen'
import { ApiKeyPanel } from '@/components/settings/ApiKeyPanel'
import { IslandHeader, IslandIconButton, IslandSection } from '@/components/ui/IslandPrimitives'
import { IslandButton } from '@/components/ui/IslandButton'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import type { AIProvider } from '@/types'

export default function ProviderSettingsScreen() {
  const { colors } = useAppTheme()
  const providers = useSettingsStore((state) => state.providers)
  const addProvider = useSettingsStore((state) => state.addProvider)
  const enabled = providers.filter((provider) => provider.enabled).length
  const credentialGroups = providers.reduce((sum, provider) => sum + (provider.credentialGroups?.length ?? 0), 0)

  async function addCustomProvider() {
    const id = `custom-${Date.now().toString(36)}`
    const provider: AIProvider = {
      id,
      presetId: 'custom-openai-compatible',
      detectedPresetId: 'custom-openai-compatible',
      detectionStatus: 'manual',
      type: 'openai-compatible',
      name: '自定义供应商',
      apiKey: '',
      models: [],
      enabled: false,
    }
    await addProvider(provider)
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 46 }}>
        <IslandHeader
          title="供应商"
          subtitle="自动识别、多令牌、低速同步"
          leading={
            <IslandIconButton label="返回" onPress={() => router.back()}>
              <ChevronLeft color={colors.text} size={23} strokeWidth={1.9} />
            </IslandIconButton>
          }
          trailing={
            <IslandIconButton label="添加供应商" tone="ink" onPress={() => void addCustomProvider()}>
              <Plus color={colors.surface} size={20} strokeWidth={2} />
            </IslandIconButton>
          }
        />

        <IslandSection title="连接概况" subtitle="令牌只保存在本机 SecureStore；导出 JSON 不包含密钥。" style={{ marginTop: 16 }}>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <MiniStat label={`已启用 ${enabled}`} />
            <MiniStat label={`令牌组 ${credentialGroups}`} />
            <MiniStat label={`供应商 ${providers.length}`} />
          </View>
          <IslandButton label="添加自定义供应商" icon={<Plus color={colors.textSecondary} size={16} />} onPress={() => void addCustomProvider()} style={{ marginTop: 12 }} />
        </IslandSection>

        <Text style={{ color: colors.text, fontSize: 17, fontWeight: '900', marginTop: 22, marginBottom: 10 }}>供应商列表</Text>
        {providers.map((provider, index) => <ApiKeyPanel key={provider.id} provider={provider} initiallyExpanded={index === 0 && !provider.enabled} />)}
      </ScrollView>
    </Screen>
  )
}

function MiniStat({ label }: { label: string }) {
  const { colors } = useAppTheme()
  return (
    <View style={{ minHeight: 30, borderRadius: 15, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.islandRaised, borderWidth: 1, borderColor: colors.border }}>
      <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '900' }}>{label}</Text>
    </View>
  )
}
