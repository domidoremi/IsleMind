import { useEffect, useMemo, useRef, useState } from 'react'
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/ui/AppIcon'
import { ISLE_MIN_TOUCH_TARGET, IsleButton, IslePressable, IsleToggle, useIsleDialog } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import type { AIProvider } from '@/types/providerContracts'
import {
  createProviderUsageQueryConfiguration,
  normalizeProviderUsageQueryConfiguration,
  parseProviderUsageQueryRecipesText,
  providerUsageQueryConfigurationFingerprint,
  PROVIDER_USAGE_QUERY_EXAMPLE,
  PROVIDER_USAGE_QUERY_EXAMPLE_RECIPE,
  type ProviderUsageQueryRecipe,
} from '@/modules/providers'
import { invalidateProviderUsage, queryProviderUsage } from '@/bootstrap/providerUsageRuntime'
import { resolveProviderDisplayName } from '@/presentation/features/settings/providerPresentation'

type UsageQueryEditorTask = 'idle' | 'saving' | 'refreshing'

export function ProviderUsageQueryEditor({ provider, onDirtyChange }: { provider: AIProvider; onDirtyChange?: (dirty: boolean) => void }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const updateProvider = useSettingsStore((state) => state.updateProvider)
  const configurationFingerprint = providerUsageQueryConfigurationFingerprint(provider.usageQueryConfiguration)
  const configuration = useMemo(
    () => normalizeProviderUsageQueryConfiguration(provider.usageQueryConfiguration),
    [configurationFingerprint],
  )
  const baselineText = useMemo(() => formatUsageQueryRecipes(
    configuration.recipes.length ? configuration.recipes : [PROVIDER_USAGE_QUERY_EXAMPLE_RECIPE],
  ), [configurationFingerprint])
  const [enabled, setEnabled] = useState(configuration.enabled)
  const [editorText, setEditorText] = useState(baselineText)
  const [task, setTask] = useState<UsageQueryEditorTask>('idle')
  const [referenceOpen, setReferenceOpen] = useState(false)
  const refreshController = useRef<AbortController | null>(null)
  const activeProviderId = useRef(provider.id)

  useEffect(() => {
    setEnabled(configuration.enabled)
    setEditorText(baselineText)
  }, [baselineText, configuration.enabled, provider.id])

  useEffect(() => {
    activeProviderId.current = provider.id
    setTask('idle')
    setReferenceOpen(false)
  }, [provider.id])

  useEffect(() => () => {
    refreshController.current?.abort()
    refreshController.current = null
  }, [provider.id])

  const validation = useMemo(() => validateEditorText(enabled, editorText), [editorText, enabled])
  const dirty = enabled !== configuration.enabled || editorText.trim() !== baselineText.trim()
  const busy = task !== 'idle'
  const providerDisplayName = resolveProviderDisplayName(provider, t('providerSettings.customProvider'))

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  const status = task === 'saving'
    ? { label: t('providerSettings.usageQuerySaving'), tone: 'working' as const }
    : task === 'refreshing'
      ? { label: t('providerSettings.usageQueryRefreshing'), tone: 'working' as const }
      : !enabled
        ? { label: t('providerSettings.usageQueryDisabled'), tone: 'muted' as const }
        : validation.valid
          ? { label: dirty ? t('providerSettings.usageQueryUnsaved') : t('providerSettings.usageQueryEnabled'), tone: dirty ? 'warning' as const : 'success' as const }
          : { label: t('providerSettings.usageQueryNeedsFix'), tone: 'danger' as const }

  function toggleEnabled() {
    if (busy) return
    const next = !enabled
    setEnabled(next)
    dialog.toast({
      title: next ? t('providerSettings.usageQueryDraftEnabled') : t('providerSettings.usageQueryDraftDisabled'),
      message: t('providerSettings.usageQuerySaveRequired'),
      tone: next ? 'mint' : 'amber',
      durationMs: 1600,
    })
  }

  function restoreSavedConfiguration() {
    if (busy || !dirty) return
    setEnabled(configuration.enabled)
    setEditorText(baselineText)
    dialog.toast({
      title: t('providerSettings.usageQueryChangesDiscarded'),
      message: providerDisplayName,
      tone: 'amber',
    })
  }

  function applySafeExample() {
    if (busy) return
    setEditorText(formatUsageQueryRecipes([PROVIDER_USAGE_QUERY_EXAMPLE_RECIPE]))
    dialog.toast({
      title: t('providerSettings.usageQueryExampleApplied'),
      message: t('providerSettings.usageQuerySaveRequired'),
      tone: 'mint',
    })
  }

  async function saveAndRefresh() {
    if (busy || !dirty) return
    let recipes: readonly ProviderUsageQueryRecipe[]
    if (enabled) {
      if (!validation.valid) {
        dialog.notice({
          title: t('providerSettings.usageQueryInvalid'),
          message: t('providerSettings.usageQueryInvalidDetail'),
          tone: 'danger',
        })
        return
      }
      recipes = validation.recipes
    } else {
      recipes = validation.valid ? validation.recipes : configuration.recipes
    }

    const nextConfiguration = createProviderUsageQueryConfiguration(enabled, recipes)
    setTask('saving')
    dialog.toast({
      title: t('providerSettings.usageQuerySaving'),
      message: providerDisplayName,
      tone: 'mint',
      durationMs: 1400,
    })
    try {
      await updateProvider(provider.id, { usageQueryConfiguration: nextConfiguration })
    } catch {
      if (activeProviderId.current !== provider.id) return
      setTask('idle')
      dialog.notice({
        title: t('providerSettings.usageQuerySaveFailed'),
        message: t('providerSettings.usageQuerySaveFailedDetail'),
        tone: 'danger',
      })
      return
    }
    if (activeProviderId.current !== provider.id) return

    invalidateProviderUsage(provider.id)
    if (!provider.enabled || !provider.baseUrl?.trim()) {
      setTask('idle')
      dialog.toast({
        title: t('providerSettings.usageQuerySaved'),
        message: t('providerSettings.usageQueryRefreshSkipped'),
        tone: 'mint',
      })
      return
    }

    refreshController.current?.abort()
    const controller = new AbortController()
    refreshController.current = controller
    setTask('refreshing')
    dialog.toast({
      title: t('providerSettings.usageQueryRefreshing'),
      message: t('providerSettings.usageQueryRefreshingDetail'),
      tone: 'mint',
      durationMs: 1400,
    })
    try {
      const result = await queryProviderUsage(
        { ...provider, usageQueryConfiguration: nextConfiguration },
        { forceRefresh: true, signal: controller.signal },
      )
      if (controller.signal.aborted || activeProviderId.current !== provider.id) return
      dialog.toast({
        title: t('providerSettings.usageQuerySaved'),
        message: result
          ? t('providerSettings.usageQueryRefreshDone')
          : t('providerSettings.usageQueryRefreshUnavailable'),
        tone: result ? 'mint' : 'amber',
      })
    } catch {
      if (!controller.signal.aborted && activeProviderId.current === provider.id) {
        dialog.toast({
          title: t('providerSettings.usageQuerySaved'),
          message: t('providerSettings.usageQueryRefreshFailed'),
          tone: 'amber',
        })
      }
    } finally {
      if (refreshController.current === controller) {
        refreshController.current = null
        setTask('idle')
      }
    }
  }

  const validationColor = status.tone === 'success'
    ? colors.ui.tone.success.foreground
    : status.tone === 'danger'
      ? colors.ui.tone.danger.foreground
      : status.tone === 'warning'
        ? colors.ui.tone.warning.foreground
        : colors.textTertiary

  return (
    <View testID={`provider-usage-query-editor-${provider.id}`} style={{ marginTop: 16, paddingTop: 14, gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.ui.section.divider }}>
      <View style={{ minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        <View style={{ width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.icon.accentBackground }}>
          <AppIcon name="chart" color={colors.ui.icon.accentForeground} size={15} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '900' }}>{t('providerSettings.usageQueryTitle')}</Text>
          <Text style={{ color: colors.textTertiary, fontSize: 10.5, lineHeight: 15, fontWeight: '600' }}>{t('providerSettings.usageQuerySubtitle')}</Text>
        </View>
        <View accessibilityLiveRegion="polite" style={{ minHeight: 26, maxWidth: 132, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: colors.ui.semantic.surface.muted, borderWidth: StyleSheet.hairlineWidth, borderColor: validationColor }}>
          <Text numberOfLines={1} style={{ color: validationColor, fontSize: 9.5, lineHeight: 13, fontWeight: '900' }}>{status.label}</Text>
        </View>
      </View>

      <IsleToggle
        title={t('providerSettings.usageQueryToggle')}
        description={t('providerSettings.usageQueryToggleDetail')}
        active={enabled}
        icon={<AppIcon name="code" color={enabled ? colors.ui.control.primaryForeground : colors.textSecondary} size={15} />}
        onPress={toggleEnabled}
      />

      {enabled ? (
        <View style={{ gap: 8 }}>
          <View style={{ minHeight: 210, overflow: 'hidden', borderRadius: 8, backgroundColor: colors.ui.input.background, borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth, borderColor: validation.valid ? colors.ui.input.border : colors.ui.tone.danger.border }}>
            <TextInput
              testID="provider-usage-query-json-input"
              value={editorText}
              onChangeText={setEditorText}
              editable={!busy}
              multiline
              scrollEnabled
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              accessibilityLabel={t('providerSettings.usageQueryJsonLabel')}
              placeholder={t('providerSettings.usageQueryJsonPlaceholder')}
              placeholderTextColor={colors.textTertiary}
              textAlignVertical="top"
              style={{ minHeight: 210, maxHeight: 320, paddingHorizontal: 12, paddingVertical: 11, color: colors.text, fontSize: 11, lineHeight: 16, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }), includeFontPadding: false }}
            />
          </View>
          <View accessibilityLiveRegion="polite" style={{ minHeight: 30, flexDirection: 'row', alignItems: 'flex-start', gap: 7 }}>
            <AppIcon name={validation.valid ? 'check' : 'warning'} color={validation.valid ? colors.ui.tone.success.foreground : colors.ui.tone.danger.foreground} size={14} style={{ marginTop: 1 }} />
            <Text style={{ flex: 1, minWidth: 0, color: validation.valid ? colors.textSecondary : colors.ui.tone.danger.foreground, fontSize: 10.5, lineHeight: 15, fontWeight: '700' }}>
              {validation.valid ? t('providerSettings.usageQueryValid', { count: validation.recipes.length }) : t('providerSettings.usageQueryInvalidDetail')}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <IsleButton
              label={t('providerSettings.usageQueryUseExample')}
              compact
              icon={<AppIcon name="json" color={colors.textSecondary} size={14} />}
              onPress={applySafeExample}
              disabled={busy}
              style={{ minHeight: 40 }}
            />
            {dirty ? (
              <IsleButton
                label={t('common.cancel')}
                compact
                icon={<AppIcon name="undo" color={colors.textSecondary} size={14} />}
                onPress={restoreSavedConfiguration}
                disabled={busy}
                style={{ minHeight: 40 }}
              />
            ) : null}
            <IsleButton
              testID="provider-usage-query-save"
              label={task === 'saving' ? t('providerSettings.usageQuerySaving') : task === 'refreshing' ? t('providerSettings.usageQueryRefreshing') : t('providerSettings.usageQuerySaveAndRefresh')}
              compact
              tone="primary"
              busy={busy}
              icon={<AppIcon name="refresh" color={colors.ui.control.primaryForeground} size={14} />}
              onPress={() => void saveAndRefresh()}
              disabled={!dirty || busy || !validation.valid}
              style={{ minHeight: 40, flexGrow: 1 }}
            />
          </View>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.textTertiary, fontSize: 10.5, lineHeight: 15, fontWeight: '600' }}>{t('providerSettings.usageQueryDisabledDetail')}</Text>
          {dirty ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <IsleButton
                label={t('common.cancel')}
                compact
                icon={<AppIcon name="undo" color={colors.textSecondary} size={14} />}
                onPress={restoreSavedConfiguration}
                disabled={busy}
                style={{ minHeight: 40 }}
              />
              <IsleButton
                testID="provider-usage-query-save"
                label={task === 'saving' ? t('providerSettings.usageQuerySaving') : task === 'refreshing' ? t('providerSettings.usageQueryRefreshing') : t('providerSettings.usageQuerySaveAndRefresh')}
                compact
                tone="primary"
                busy={busy}
                icon={<AppIcon name="refresh" color={colors.ui.control.primaryForeground} size={14} />}
                onPress={() => void saveAndRefresh()}
                disabled={busy}
                style={{ minHeight: 40, flexGrow: 1 }}
              />
            </View>
          ) : null}
        </View>
      )}

      <IslePressable
        haptic
        accessibilityRole="button"
        accessibilityState={{ expanded: referenceOpen }}
        accessibilityLabel={t('providerSettings.usageQueryReference')}
        onPress={() => setReferenceOpen((value) => !value)}
        style={{ minHeight: ISLE_MIN_TOUCH_TARGET, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 8, backgroundColor: colors.ui.semantic.surface.muted }}
      >
        <AppIcon name="info" color={colors.textTertiary} size={14} />
        <Text style={{ flex: 1, color: colors.textSecondary, fontSize: 11, lineHeight: 15, fontWeight: '800' }}>{t('providerSettings.usageQueryReference')}</Text>
        <AppIcon name="collapse" color={colors.textTertiary} size={14} style={{ transform: [{ rotate: referenceOpen ? '180deg' : '0deg' }] }} />
      </IslePressable>
      {referenceOpen ? (
        <View style={{ gap: 6 }}>
          <Text style={{ color: colors.textTertiary, fontSize: 10.5, lineHeight: 15, fontWeight: '600' }}>{t('providerSettings.usageQueryReferenceDetail')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <Text selectable style={{ color: colors.textSecondary, fontSize: 10, lineHeight: 15, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }), paddingVertical: 6 }}>
              {PROVIDER_USAGE_QUERY_EXAMPLE}
            </Text>
          </ScrollView>
        </View>
      ) : null}
    </View>
  )
}

function formatUsageQueryRecipes(recipes: readonly ProviderUsageQueryRecipe[]): string {
  return JSON.stringify(recipes.length === 1 ? recipes[0] : recipes, null, 2)
}

function validateEditorText(
  enabled: boolean,
  text: string,
): { valid: true; recipes: readonly ProviderUsageQueryRecipe[] } | { valid: false; recipes: readonly [] } {
  try {
    return { valid: true, recipes: parseProviderUsageQueryRecipesText(text) }
  } catch {
    return enabled
      ? { valid: false, recipes: [] }
      : { valid: true, recipes: [] }
  }
}
