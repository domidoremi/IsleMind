import { useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import type { ReactNode } from 'react'
import { ChevronLeft, Download, Moon, RotateCcw, Smartphone, Sun, Trash2, Upload } from 'lucide-react-native'
import { router } from 'expo-router'
import { MotiView } from 'moti'
import { Screen } from '@/components/ui/Screen'
import { ApiKeyPanel } from '@/components/settings/ApiKeyPanel'
import { ContextPanel } from '@/components/settings/ContextPanel'
import { PressableScale } from '@/components/ui/PressableScale'
import { Pill } from '@/components/ui/Pill'
import { IslandButton } from '@/components/ui/IslandButton'
import { IslandDisclosure, IslandField, IslandHeader, IslandIconButton, IslandSection } from '@/components/ui/IslandPrimitives'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import { useChatStore } from '@/store/chatStore'
import { exportToJsonFile, importFromJsonFile } from '@/services/portableData'
import { checkLatestApkRelease, downloadAndOpenApkInstaller, getVersionSnapshot, type ApkReleaseInfo } from '@/services/appUpdates'
import { useIslandDialog } from '@/components/ui/IslandDialog'
import type { ThemeMode } from '@/types'

export default function SettingsScreen() {
  const { colors } = useAppTheme()
  const dialog = useIslandDialog()
  const providers = useSettingsStore((state) => state.providers)
  const settings = useSettingsStore((state) => state.settings)
  const setTheme = useSettingsStore((state) => state.setTheme)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const resetSettings = useSettingsStore((state) => state.clearAll)
  const clearChats = useChatStore((state) => state.clearAll)
  const enabledProviders = providers.filter((provider) => provider.enabled).length
  const defaultProvider = providers.find((provider) => provider.id === settings.defaultProvider)
  const version = getVersionSnapshot()
  const [updateBusy, setUpdateBusy] = useState<'apk' | null>(null)

  async function exportJson() {
    const uri = await exportToJsonFile()
    dialog.notice({ title: '导出完成', message: `JSON 已保存到应用文档目录：\n${uri}`, tone: 'mint' })
  }

  async function importJson() {
    const ok = await importFromJsonFile()
    dialog.notice({
      title: ok ? '导入完成' : '未导入',
      message: ok ? '对话和设置已从 JSON 恢复。' : '没有选择文件，或 JSON 结构不正确。',
      tone: ok ? 'mint' : 'amber',
    })
  }

  function confirmClearChats() {
    void dialog.confirm({
      title: '清空所有对话',
      message: '这会删除本机保存的所有对话记录，但不会删除 API Key。',
      tone: 'danger',
      confirmLabel: '清空',
      cancelLabel: '取消',
    }).then((confirmed) => {
      if (confirmed) clearChats()
    })
  }

  function confirmResetSettings() {
    void dialog.confirm({
      title: '重置设置',
      message: '这会恢复主题、默认参数和服务商配置，并删除本机 SecureStore 中保存的 API Key。',
      tone: 'danger',
      confirmLabel: '重置',
      cancelLabel: '取消',
    }).then((confirmed) => {
      if (confirmed) void resetSettings()
    })
  }

  async function checkApkUpdate() {
    setUpdateBusy('apk')
    try {
      const result = await checkLatestApkRelease()
      if (result.status !== 'available' || !result.release) {
        dialog.notice({
          title: result.status === 'error' ? 'APK 检查失败' : '没有新版 APK',
          message: result.message,
          tone: result.status === 'error' ? 'danger' : result.status === 'unsupported' ? 'amber' : 'mint',
        })
        return
      }

      const confirmed = await confirmApkInstall(result.release)
      if (!confirmed) return

      const installResult = await downloadAndOpenApkInstaller(result.release)
      dialog.notice({
        title: installResult.status === 'downloaded' ? '安装器已打开' : 'APK 更新失败',
        message: installResult.message,
        tone: installResult.status === 'downloaded' ? 'mint' : 'danger',
      })
    } finally {
      setUpdateBusy(null)
    }
  }

  function confirmApkInstall(release: ApkReleaseInfo) {
    return dialog.confirm({
      title: `安装 ${release.version}？`,
      message: 'IsleMind 会优先下载 GitHub Release 里的 universal APK，并打开 Android 系统安装器。系统会要求你确认安装，这一步无法静默完成。',
      confirmLabel: '下载并安装',
      cancelLabel: '稍后',
      tone: 'amber',
      chips: [
        { label: release.apkName, tone: 'mint' },
        { label: release.tagName || release.name },
      ],
    })
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 46 }}>
        <IslandHeader
          title="设置"
          subtitle="Local first"
          leading={
            <IslandIconButton label="返回" onPress={() => router.back()}>
              <ChevronLeft color={colors.text} size={23} strokeWidth={1.9} />
            </IslandIconButton>
          }
        />
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <MiniStat label={`已启用 ${enabledProviders}`} />
          <MiniStat label={defaultProvider ? `默认 ${defaultProvider.name}` : '未设默认'} />
          <MiniStat label={settings.webSearchEnabled ? `搜索 ${settings.webSearchMode ?? 'native'}` : '搜索关闭'} />
        </View>

        <IslandSection title="主题" subtitle="界面色彩只影响本机显示。" style={{ marginTop: 18 }}>
          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            {(['system', 'light', 'dark'] satisfies ThemeMode[]).map((item) => (
              <PressableScale key={item} haptic onPress={() => setTheme(item)}>
                <Pill active={settings.theme === item}>{item === 'system' ? '跟随系统' : item === 'light' ? '浅色' : '深色'}</Pill>
              </PressableScale>
            ))}
          </View>
        </IslandSection>

        <SectionTitle title="服务商" />
        {providers.map((provider) => (
          <ApiKeyPanel key={provider.id} provider={provider} />
        ))}

        <CollapsibleSection
          title="上下文与知识"
          summary={[
            settings.memoryEnabled ? '记忆开' : '记忆关',
            settings.knowledgeEnabled ? '知识库开' : '知识库关',
            settings.webSearchEnabled ? `搜索 ${settings.webSearchMode ?? 'native'}` : '搜索关',
          ].join(' · ')}
        >
          <ContextPanel providers={providers} />
        </CollapsibleSection>

        <CollapsibleSection title="偏好" summary="默认参数、触觉反馈" compact>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
            <SettingInput
              label="默认温度"
              value={String(settings.defaultTemperature ?? 0.7)}
              onChange={(value) => {
                const next = Number(value)
                if (!Number.isNaN(next)) updateSettings({ defaultTemperature: Math.max(0, Math.min(2, next)) })
              }}
            />
            <SettingInput
              label="默认 Token"
              value={settings.defaultMaxTokens ? String(settings.defaultMaxTokens) : ''}
              onChange={(value) => {
                if (!value.trim()) {
                  updateSettings({ defaultMaxTokens: undefined })
                  return
                }
                const next = Number.parseInt(value, 10)
                if (!Number.isNaN(next)) updateSettings({ defaultMaxTokens: Math.max(128, Math.min(128000, next)) })
              }}
              placeholder="跟随模型"
            />
          </View>
          <PressableScale haptic onPress={() => updateSettings({ hapticsEnabled: !settings.hapticsEnabled })} style={{ minHeight: 54, borderRadius: 22, paddingHorizontal: 14, backgroundColor: colors.islandRaised, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: colors.border }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {settings.hapticsEnabled ? <Sun color={colors.text} size={18} /> : <Moon color={colors.text} size={18} />}
              <Text style={{ color: colors.text, fontSize: 15, fontWeight: '800' }}>触觉反馈</Text>
            </View>
            <Pill active={settings.hapticsEnabled}>{settings.hapticsEnabled ? '开启' : '关闭'}</Pill>
          </PressableScale>
        </CollapsibleSection>

        <CollapsibleSection title="版本更新" summary={`当前 ${version.appVersion} · APK 冷更新`} compact>
          <View style={{ gap: 10 }}>
            <View style={{ borderRadius: 22, padding: 13, backgroundColor: colors.material.paperRaised, borderWidth: 1, borderColor: colors.border }}>
              <VersionRow label="应用版本" value={`${version.appVersion} (${version.buildVersion})`} />
              <VersionRow label="更新方式" value="GitHub Release APK" />
              <VersionRow label="安装方式" value="Android 系统安装器" />
            </View>
            <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 18, fontWeight: '700' }}>
              IsleMind 当前采用 APK 冷更新。每次发布新版都下载 APK，由 Android 系统安装器确认安装。
            </Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <DataButton
                label="检查 APK"
                icon={<Smartphone color={colors.surface} size={18} />}
                busy={updateBusy === 'apk'}
                disabled={updateBusy !== null}
                onPress={checkApkUpdate}
              />
            </View>
          </View>
        </CollapsibleSection>

        <CollapsibleSection title="导入 / 导出" summary="JSON 不包含 SecureStore Key" compact>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <DataButton label="导出 JSON" icon={<Download color={colors.surface} size={18} />} onPress={exportJson} />
            <DataButton label="导入 JSON" icon={<Upload color={colors.surface} size={18} />} onPress={importJson} />
          </View>
        </CollapsibleSection>

        <CollapsibleSection title="危险操作" summary="清空对话、重置设置" compact danger>
          <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginBottom: 10 }}>
            这些操作会改变本机数据。API Key 只会在“重置设置”时删除。
          </Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <DangerButton label="清空对话" icon={<Trash2 color={colors.error} size={18} />} onPress={confirmClearChats} />
            <DangerButton label="重置设置" icon={<RotateCcw color={colors.error} size={18} />} onPress={confirmResetSettings} />
          </View>
        </CollapsibleSection>
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

function CollapsibleSection({
  title,
  summary,
  children,
  compact = false,
  danger = false,
}: {
  title: string
  summary: string
  children: ReactNode
  compact?: boolean
  danger?: boolean
}) {
  const { colors } = useAppTheme()
  const [expanded, setExpanded] = useState(false)
  return (
    <View style={{ marginTop: compact ? 12 : 16 }}>
      <IslandDisclosure title={title} summary={summary} expanded={expanded} danger={danger} onPress={() => setExpanded((value) => !value)} />
      {expanded ? (
        <MotiView
          from={{ opacity: 0, translateY: -6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', damping: 20, stiffness: 180 }}
          style={{ paddingTop: 12 }}
        >
          {children}
        </MotiView>
      ) : null}
    </View>
  )
}

function SettingInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <IslandField label={label} style={{ flex: 1 }} inputProps={{ value, onChangeText: onChange, placeholder, keyboardType: 'numeric' }} />
  )
}

function SectionTitle({ title }: { title: string }) {
  const { colors } = useAppTheme()
  return <Text style={{ color: colors.text, fontSize: 17, fontWeight: '800', marginTop: 24, marginBottom: 10 }}>{title}</Text>
}

function VersionRow({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme()
  return (
    <View style={{ minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '900', width: 76 }}>{label}</Text>
      <Text numberOfLines={1} style={{ color: colors.text, fontSize: 12, fontWeight: '800', flex: 1 }}>{value}</Text>
    </View>
  )
}

function DataButton({ label, icon, onPress, busy = false, disabled = false }: { label: string; icon: ReactNode; onPress: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <IslandButton label={label} icon={icon} tone="primary" busy={busy} disabled={disabled} onPress={onPress} style={{ flex: 1, minHeight: 54, borderRadius: 27 }} />
  )
}

function DangerButton({ label, icon, onPress }: { label: string; icon: ReactNode; onPress: () => void }) {
  const { colors } = useAppTheme()
  return (
    <IslandButton label={label} icon={icon} tone="danger" onPress={onPress} style={{ flex: 1, minHeight: 54, borderRadius: 27 }} />
  )
}
