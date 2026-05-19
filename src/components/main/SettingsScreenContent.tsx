import { useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import type { ReactNode } from 'react'
import { Download, KeyRound, Moon, RotateCcw, Smartphone, Sun, Trash2, Upload } from 'lucide-react-native'
import { router } from 'expo-router'
import { MotiView } from 'moti'
import { ContextPanel } from '@/components/settings/ContextPanel'
import { PressableScale } from '@/components/ui/PressableScale'
import { Pill } from '@/components/ui/Pill'
import { IslandButton } from '@/components/ui/IslandButton'
import { IslandDisclosure, IslandField, IslandHeader, IslandSection } from '@/components/ui/IslandPrimitives'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import { useChatStore } from '@/store/chatStore'
import { exportToJsonFile, importFromJsonFile } from '@/services/portableData'
import { checkLatestApkRelease, downloadAndOpenApkInstaller, formatUpdateCheckTime, getVersionSnapshot, type ApkReleaseInfo } from '@/services/appUpdates'
import { useIslandDialog } from '@/components/ui/IslandDialog'
import { resolveSearchProvider, searchProviderLabel } from '@/services/searchPolicy'
import type { ThemeMode } from '@/types'

interface SettingsScreenContentProps {
  onProviders?: () => void
}

export function SettingsScreenContent({ onProviders }: SettingsScreenContentProps) {
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
  const searchProvider = resolveSearchProvider(settings)

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
      message: '确认清空所有对话？',
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
      message: '确认重置设置并删除 API Key？',
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
      updateSettings({ lastApkUpdateCheckAt: Date.now() })
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
      message: '确认下载并安装？',
      confirmLabel: '下载并安装',
      cancelLabel: '稍后',
      tone: 'amber',
      chips: [
        { label: release.apkName, tone: 'mint' },
        { label: release.tagName || release.name },
      ],
    })
  }

  function toggleAutoCheck() {
    const next = !(settings.autoUpdateCheckEnabled ?? true)
    updateSettings({ autoUpdateCheckEnabled: next })
    dialog.toast({ title: next ? '已开启自动检查' : '已关闭自动检查', message: '冷更新策略：GitHub Release APK。', tone: next ? 'mint' : 'amber' })
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 46 }}>
      <IslandHeader title="设置" />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        <MiniStat label={`已启用 ${enabledProviders}`} />
        <MiniStat label={defaultProvider ? `默认 ${defaultProvider.name}` : '未设默认'} />
        <MiniStat label={searchProvider !== 'off' ? `搜索 ${searchProviderLabel(searchProvider)}` : '搜索关闭'} />
      </View>

      <IslandSection title="主题" style={{ marginTop: 18 }}>
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
          {(['system', 'light', 'dark'] satisfies ThemeMode[]).map((item) => (
            <PressableScale key={item} haptic onPress={() => setTheme(item)}>
              <Pill active={settings.theme === item}>{item === 'system' ? '跟随系统' : item === 'light' ? '浅色' : '深色'}</Pill>
            </PressableScale>
          ))}
        </View>
      </IslandSection>

      <IslandSection
        title="供应商"
        style={{ marginTop: 18 }}
        action={<IslandButton label="管理" compact icon={<KeyRound color={colors.textSecondary} size={15} />} onPress={onProviders ?? (() => router.push('/settings/providers'))} />}
      >
        <View style={{ gap: 8 }}>
          <VersionRow label="启用" value={`${enabledProviders} / ${providers.length}`} />
          <VersionRow label="默认" value={defaultProvider ? defaultProvider.name : '未设置'} />
          <VersionRow label="令牌组" value={`${providers.reduce((sum, provider) => sum + (provider.credentialGroups?.length ?? 0), 0)} 组`} />
        </View>
      </IslandSection>

      <CollapsibleSection title="上下文与知识">
        <ContextPanel providers={providers} />
      </CollapsibleSection>

      <CollapsibleSection title="偏好" compact>
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

      <CollapsibleSection title="版本更新" summary={`当前 ${version.appVersion}`} compact>
        <View style={{ gap: 10 }}>
          <View style={{ borderRadius: 22, padding: 13, backgroundColor: colors.material.paperRaised, borderWidth: 1, borderColor: colors.border }}>
            <VersionRow label="应用版本" value={`${version.appVersion} (${version.buildVersion})`} />
            <VersionRow label="冷更新" value="GitHub Release APK" />
            <VersionRow label="热更新" value="未启用" />
            <VersionRow label="自动检查" value={(settings.autoUpdateCheckEnabled ?? true) ? '开启' : '关闭'} />
            <VersionRow label="上次检查" value={formatUpdateCheckTime(settings.lastApkUpdateCheckAt)} />
          </View>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <DataButton
              label="检查 APK"
              icon={<Smartphone color={colors.surface} size={18} />}
              busy={updateBusy === 'apk'}
              disabled={updateBusy !== null}
              onPress={checkApkUpdate}
            />
            <IslandButton
              label={(settings.autoUpdateCheckEnabled ?? true) ? '自动开启' : '自动关闭'}
              tone="soft"
              onPress={toggleAutoCheck}
              style={{ flex: 1, minHeight: 54, borderRadius: 27 }}
            />
          </View>
        </View>
      </CollapsibleSection>

      <CollapsibleSection title="导入 / 导出" compact>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <DataButton label="导出 JSON" icon={<Download color={colors.surface} size={18} />} onPress={exportJson} />
          <DataButton label="导入 JSON" icon={<Upload color={colors.surface} size={18} />} onPress={importJson} />
        </View>
      </CollapsibleSection>

      <CollapsibleSection title="危险操作" compact danger>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <DangerButton label="清空对话" icon={<Trash2 color={colors.error} size={18} />} onPress={confirmClearChats} />
          <DangerButton label="重置设置" icon={<RotateCcw color={colors.error} size={18} />} onPress={confirmResetSettings} />
        </View>
      </CollapsibleSection>
    </ScrollView>
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
  summary?: string
  children: ReactNode
  compact?: boolean
  danger?: boolean
}) {
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
