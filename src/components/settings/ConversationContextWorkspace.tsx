import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import type { Conversation } from '@/types/chatContracts'
import {
  CONVERSATION_CONTEXT_POLICY_BUSY, CONVERSATION_CONTEXT_POLICY_CONFLICT,
  CONVERSATION_CONTEXT_POLICY_SCHEMA, conversationContextPolicyRevision, normalizeConversationContextPolicy,
} from '@/modules/conversations'
import { previewContextCompactionThreshold } from '@/modules/assistant-runtime'
import { resolveProviderRemoteCompactThreshold } from '@/modules/providers'
import { loadContextCapacity, type ContextCapacityLoadResult } from '@/bootstrap/contextCapacityRuntime'
import { loadConversationContextTarget, saveConversationContextPolicy } from '@/bootstrap/conversationContextPolicyRuntime'
import { ContextCapacityContent } from '@/components/chat/ContextCapacitySheet'
import { Text, TextInput } from '@/components/ui/AppText'
import { IsleButton } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useSettingsDraft, useSettingsLeave } from './SettingsEditBoundary'

type Draft = { inherit: boolean; text: string }
type Base = Draft & { revision: string }
type Preview = { signature: string; revision: string; globalThreshold: number }

export function ConversationContextWorkspace({
  conversationId, onOpenGlobal, loadCapacity = loadContextCapacity, loadTarget = loadConversationContextTarget,
  savePolicy = saveConversationContextPolicy,
}: {
  conversationId: string
  onOpenGlobal: () => void
  loadCapacity?: typeof loadContextCapacity
  loadTarget?: typeof loadConversationContextTarget
  savePolicy?: typeof saveConversationContextPolicy
}) {
  const { t, i18n } = useTranslation()
  const { colors } = useAppTheme()
  const typography = colors.design!.semantic.typography
  const settings = useSettingsStore(state => state.settings)
  const liveConversation = useChatStore(state => state.conversations.find(item => item.id === conversationId))
  const leave = useSettingsLeave()
  const [loadedConversation, setLoadedConversation] = useState<Conversation>()
  const conversation = liveConversation ?? loadedConversation
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [capacity, setCapacity] = useState<ContextCapacityLoadResult>({ kind: 'empty' })
  const [refresh, setRefresh] = useState(0)
  const [draft, setDraft] = useState<Draft>({ inherit: true, text: '' })
  const [base, setBase] = useState<Base>()
  const [preview, setPreview] = useState<Preview>()
  const [saving, setSaving] = useState(false)
  const saveLock = useRef(false)
  const [feedback, setFeedback] = useState<{ error: boolean; text: string }>()
  const globalThreshold = resolveProviderRemoteCompactThreshold(settings.remoteCompactThreshold)
  const currentOverride = normalizeConversationContextPolicy(conversation?.contextPolicyOverride)
  const effectiveThreshold = currentOverride?.remoteCompactThreshold ?? globalThreshold
  const revision = conversation ? conversationContextPolicyRevision(conversation) : ''
  const signature = JSON.stringify(draft)
  const dirty = !!base && (draft.inherit !== base.inherit || (!draft.inherit && draft.text !== base.text))
  const conflict = !!base && revision !== base.revision
  const draftThreshold = draft.inherit ? globalThreshold : parseThreshold(draft.text)
  const previewCurrent = preview?.signature === signature && preview.revision === revision
    && (!draft.inherit || preview.globalThreshold === globalThreshold)
  const projected = previewCurrent && draftThreshold !== undefined && capacity.kind === 'ready'
    ? previewContextCompactionThreshold(capacity.view, draftThreshold) : undefined

  function resetEditor(source = conversation) {
    if (!source) return
    const override = normalizeConversationContextPolicy(source.contextPolicyOverride)
    const next = { inherit: !override, text: String((override?.remoteCompactThreshold ?? globalThreshold) * 100) }
    setDraft(next)
    setBase({ ...next, revision: conversationContextPolicyRevision(source) })
    setPreview(undefined)
    setFeedback(undefined)
  }
  useSettingsDraft(dirty, saving, () => resetEditor(), JSON.stringify([conversationId, base?.revision, draft]))

  useEffect(() => {
    let active = true
    setState('loading')
    void Promise.all([loadTarget(conversationId), loadCapacity(conversationId)]).then(([target, receipt]) => {
      if (!active) return
      setLoadedConversation(target)
      setCapacity(receipt)
      if (!target) { setState('missing'); return }
      resetEditor(target)
      setState('ready')
    }, () => { if (active) setState('error') })
    return () => { active = false }
  }, [conversationId, loadTarget, loadCapacity, refresh])

  function previewDraft() {
    if (draftThreshold === undefined) { setFeedback({ error: true, text: t('usage.contextInvalid') }); return }
    if (conflict) { setFeedback({ error: true, text: t('usage.contextConflict') }); return }
    setFeedback(undefined)
    setPreview({ signature, revision, globalThreshold })
  }

  async function save() {
    if (saveLock.current || !base || !dirty || !previewCurrent || draftThreshold === undefined) return
    saveLock.current = true
    setSaving(true)
    setFeedback(undefined)
    try {
      const result = await savePolicy(conversationId, draft.inherit ? undefined : {
        schema: CONVERSATION_CONTEXT_POLICY_SCHEMA, remoteCompactThreshold: draftThreshold,
      }, base.revision)
      setLoadedConversation(result.conversation)
      resetEditor(result.conversation)
      setFeedback({ error: false, text: t(result.persisted ? 'usage.contextSaved' : 'usage.contextDraftSaved') })
    } catch (error) {
      setFeedback({ error: true, text: t(error instanceof Error && error.message === CONVERSATION_CONTEXT_POLICY_CONFLICT
        ? 'usage.contextConflict' : error instanceof Error && error.message === CONVERSATION_CONTEXT_POLICY_BUSY
          ? 'usage.contextBusy' : 'usage.contextSaveFailed') })
    } finally {
      setSaving(false)
      saveLock.current = false
    }
  }

  if (state === 'loading') return <View style={styles.placeholder}><ActivityIndicator color={colors.textSecondary} /><Text>{t('common.loading')}</Text></View>
  if (state !== 'ready' || !conversation) return <View testID="context-conversation-unavailable" style={styles.section}>
    <Text accessibilityRole="header" style={[typography.title, { color: colors.text }]}>{t('usage.unavailableConversation')}</Text>
    <Text style={[typography.body, { color: colors.textSecondary }]}>{t(state === 'error' ? 'usage.loadFailed' : 'usage.contextNoConversation')}</Text>
    {state === 'error' ? <IsleButton label={t('common.retry')} onPress={() => setRefresh(value => value + 1)} /> : null}
    <IsleButton label={t('usage.contextGlobalSettings')} onPress={onOpenGlobal} />
  </View>

  return <View testID="conversation-context-workspace" style={styles.workspace}>
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[typography.headline, { color: colors.text }]}>{conversation.title}</Text>
      <Text style={[typography.body, { color: colors.textSecondary }]}>{t('usage.contextScopeHint')}</Text>
      <ContextCapacityContent state={capacity} />
      {capacity.kind === 'ready' ? <Text style={[typography.body, { color: colors.textSecondary }]}>
        {t('usage.contextRecordedAt', { time: new Date(capacity.view.capturedAt).toLocaleString(i18n.language) })}
      </Text> : null}
      {capacity.kind === 'ready' && capacity.view.contextPolicy ? <Text testID="context-captured-policy" style={[typography.body, { color: colors.textSecondary }]}>
        {t('usage.contextCapturedPolicy', {
          ratio: capacity.view.contextPolicy.threshold * 100,
          mode: t(`usage.contextMode.${capacity.view.contextPolicy.mode}`),
          strategy: capacity.view.contextPolicy.strategy,
        })}
      </Text> : null}
    </View>
    <View style={[styles.section, { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.ui.section.divider }]}>
      <Text accessibilityRole="header" style={[typography.title, { color: colors.text }]}>{t('usage.contextSettings')}</Text>
      <Text testID="context-effective-policy" style={[typography.body, { color: colors.text }]}>
        {t('usage.contextEffectivePolicy', { ratio: effectiveThreshold * 100, source: t(currentOverride ? 'usage.contextConversationOverride' : 'usage.contextInherited') })}
      </Text>
      <Text style={[typography.body, { color: colors.textSecondary }]}>
        {t('usage.contextGlobalPolicy', { ratio: globalThreshold * 100, mode: t(`usage.contextMode.${settings.remoteCompactMode ?? 'auto'}`) })}
      </Text>
      <Text style={[typography.body, { color: colors.textSecondary }]}>{t('usage.contextTrialHint')}</Text>
      <Text style={[typography.label, { color: colors.text }]}>{t('usage.contextThreshold')}</Text>
      <TextInput testID="context-threshold-input" accessibilityLabel={t('usage.contextThreshold')} keyboardType="decimal-pad"
        value={draft.text} editable={!saving} onChangeText={text => { setDraft({ inherit: false, text }); setPreview(undefined); setFeedback(undefined) }}
        style={[typography.body, styles.input, { color: colors.text, backgroundColor: colors.ui.semantic.surface.muted, borderColor: colors.ui.semantic.chrome.border }]} />
      <Text style={[typography.body, { color: colors.textSecondary }]}>{t(draft.inherit ? 'usage.contextInherited' : 'usage.contextConversationOverride')}</Text>
      <View style={styles.actions}>
        <IsleButton label={t('usage.contextPreview')} disabled={saving || conflict} onPress={previewDraft} />
        <IsleButton label={t('usage.contextRestore')} disabled={saving} onPress={() => {
          setDraft({ inherit: true, text: String(globalThreshold * 100) }); setPreview(undefined); setFeedback(undefined)
        }} />
      </View>
      {conflict ? <View style={{ gap: 10 }}>
        <Text accessibilityRole="alert" style={[typography.body, { color: colors.ui.tone.warning.foreground }]}>{t('usage.contextConflict')}</Text>
        <IsleButton label={t('settingsWorkspace.reload')} disabled={saving} onPress={() => resetEditor()} />
      </View> : null}
      {previewCurrent ? <View testID="context-policy-preview" style={[styles.preview, { backgroundColor: colors.ui.semantic.surface.muted }]}>
        <Text style={[typography.body, { color: colors.text }]}>{t('usage.contextPreviewHint', { ratio: draftThreshold! * 100 })}</Text>
        <Text style={[typography.body, { color: colors.textSecondary }]}>{t('usage.contextPreviewBudgetHint')}</Text>
        <Text style={[typography.body, { color: colors.textSecondary }]}>{projected ? t('usage.contextTriggerPreview', {
          threshold: projected.thresholdTokens.toLocaleString(i18n.language), used: projected.estimatedMessageTokens.toLocaleString(i18n.language),
          reached: t(projected.reached ? 'usage.contextPointReached' : 'usage.contextPointNotReached'),
        }) : t('usage.contextPreviewUnmeasured')}</Text>
      </View> : null}
      <Text style={[typography.body, { color: colors.textSecondary }]}>{t('usage.contextSampleUnavailable')}</Text>
      {feedback ? <Text accessibilityRole={feedback.error ? 'alert' : undefined} accessibilityLiveRegion="polite"
        testID="context-policy-feedback" style={[typography.body, { color: feedback.error ? colors.ui.tone.warning.foreground : colors.text }]}>{feedback.text}</Text> : null}
      <View style={styles.actions}>
        <IsleButton testID="context-policy-apply" label={t(saving ? 'common.saving' : 'usage.contextApply')} busy={saving}
          disabled={saving || !dirty || !previewCurrent || conflict} onPress={() => void save()} />
        <IsleButton label={t('usage.contextGlobalSettings')} disabled={saving} onPress={onOpenGlobal} />
        <IsleButton label={t('usage.openConversation')} disabled={saving}
          onPress={() => { void leave(() => router.push({ pathname: '/chat/[id]', params: { id: conversationId } })) }} />
      </View>
    </View>
  </View>
}

function parseThreshold(text: string): number | undefined {
  if (!/^\d{1,3}(?:\.\d{1,4})?$/u.test(text.trim())) return undefined
  const value = Number(text) / 100
  return Number.isFinite(value) && value >= 0.1 && value <= 2 ? value : undefined
}

const styles = StyleSheet.create({
  workspace: { width: '100%', minWidth: 0, maxWidth: 900, alignSelf: 'center', gap: 20 },
  section: { minWidth: 0, paddingVertical: 16, gap: 14 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  input: { minHeight: 48, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, maxWidth: 240 },
  preview: { padding: 16, borderRadius: 8, gap: 10 },
  placeholder: { minHeight: 160, gap: 12, alignItems: 'center', justifyContent: 'center' },
})
