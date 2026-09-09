import { useCallback, useEffect, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { AppState, Platform, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { IsleButton, IsleInput, IsleSelect } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { DOCUMENT_REVISION_INPUT_LIMIT, DOCUMENT_REVISION_INSTRUCTION_LIMIT, DocumentRevisionError, type DocumentDraft, type DocumentRevisionPort, type DocumentRevisionSource, type DocumentRevisionTarget, type SavedDocument } from '@/modules/documents'

export interface DocumentRevisionBase { draft: DocumentDraft; saved: SavedDocument | null }

export function DocumentRevisionPanel({ draft, saved, port, disabled, onAccept }: DocumentRevisionBase & {
  port: DocumentRevisionPort
  disabled: boolean
  onAccept(base: DocumentRevisionBase, body: string): Promise<boolean>
}) {
  const { t } = useTranslation()
  const { colors } = useAppTheme()
  const [open, setOpen] = useState(false)
  const [targets, setTargets] = useState<readonly DocumentRevisionTarget[]>([])
  const [targetIndex, setTargetIndex] = useState<string>()
  const [instruction, setInstruction] = useState('')
  const [sources, setSources] = useState(() => new Map<string, DocumentRevisionSource>())
  const [selected, setSelected] = useState<string[]>([])
  const [reading, setReading] = useState<string>()
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string>()
  const [proposal, setProposal] = useState<{ base: DocumentRevisionBase; body: string; target: DocumentRevisionTarget; sources: DocumentRevisionSource[] }>()
  const operation = useRef<AbortController | null>(null)
  const sourceRead = useRef<AbortController | null>(null)
  const latest = useRef({ draft, saved, port, disabled })
  latest.current = { draft, saved, port, disabled }
  const target = targetIndex === undefined ? undefined : targets[Number(targetIndex)]

  const cancel = useCallback(() => {
    if (operation.current) {
      operation.current.abort(); operation.current = null
      setRunning(false); setError('cancelled')
    }
    sourceRead.current?.abort(); sourceRead.current = null; setReading(undefined)
  }, [])

  useEffect(() => {
    cancel(); setProposal(undefined)
    return () => cancel()
  }, [draft, saved, port, cancel])
  useEffect(() => { setSources(new Map()); setSelected([]) }, [draft.origin, port])
  useFocusEffect(useCallback(() => () => cancel(), [cancel]))
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => { if (state !== 'active') cancel() })
    const visibility = () => { if (document.visibilityState !== 'visible') cancel() }
    if (Platform.OS === 'web') document.addEventListener('visibilitychange', visibility)
    return () => {
      subscription.remove()
      if (Platform.OS === 'web') document.removeEventListener('visibilitychange', visibility)
    }
  }, [cancel])

  function refreshTargets() { cancel(); setProposal(undefined); setTargets(port.listTargets()); setTargetIndex(undefined) }
  function toggleOpen() {
    cancel(); setProposal(undefined); setError(undefined)
    if (!open) refreshTargets()
    setOpen(!open)
  }
  function invalidate() { cancel(); setProposal(undefined); setError(undefined) }

  async function read(citationId: string) {
    if (!draft.origin || disabled || sourceRead.current || operation.current) return
    invalidate()
    setSelected((values) => values.filter((id) => id !== citationId))
    setSources((values) => { const next = new Map(values); next.delete(citationId); return next })
    const controller = new AbortController()
    sourceRead.current = controller
    setReading(citationId)
    try {
      const value = await port.readSource(draft.origin, citationId, controller.signal)
      if (!controller.signal.aborted && sourceRead.current === controller && latest.current.draft.origin === draft.origin) {
        setSources((values) => new Map(values).set(citationId, value))
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof DocumentRevisionError ? reason.code : 'sourceUnavailable')
    } finally {
      if (sourceRead.current === controller) { sourceRead.current = null; setReading(undefined) }
    }
  }

  async function propose() {
    if (disabled || operation.current || sourceRead.current || !target || !instruction.trim()) return
    const controller = new AbortController()
    operation.current = controller
    const base = { draft, saved }
    const chosen = selected.map((id) => sources.get(id)!).filter(Boolean)
    setRunning(true); setError(undefined); setProposal(undefined)
    try {
      const body = await port.propose({ draft, instruction, sources: chosen, target }, controller.signal)
      if (!controller.signal.aborted && operation.current === controller && latest.current.draft === draft && latest.current.saved === saved && latest.current.port === port) {
        setProposal({ base, body, target, sources: chosen })
      }
    } catch (reason) {
      if (!controller.signal.aborted && operation.current === controller) setError(reason instanceof DocumentRevisionError ? reason.code : 'generationFailed')
    } finally {
      if (operation.current === controller) { operation.current = null; setRunning(false) }
    }
  }

  async function accept() {
    if (!proposal || disabled || proposal.base.draft !== latest.current.draft || proposal.base.saved !== latest.current.saved) return
    if (await onAccept(proposal.base, proposal.body)) setProposal(undefined)
    else setError('staleProposal')
  }

  const citations = (draft.origin?.citations ?? []).filter((citation, index, all) => citation.type !== 'web'
    && all.findIndex((item) => item.id === citation.id) === index
    && all.findIndex((item) => item.type === citation.type && (citation.type === 'knowledge' ? item.documentId === citation.documentId : item.id === citation.id)) === index)
  return <View testID="document-revision" style={{ gap: 12, borderTopWidth: 1, borderTopColor: colors.ui.semantic.chrome.border, paddingTop: 16 }}>
    <IsleButton label={t(open ? 'documents.revision.close' : 'documents.revision.open')} onPress={toggleOpen} />
    {open ? <>
      <Text selectable style={{ color: colors.textSecondary }}>{t('documents.revision.notice')}</Text>
      <IsleSelect options={targets.map((item, index) => ({ value: String(index), label: `${item.providerName} · ${item.model}` }))}
        value={targetIndex} placeholder={t('documents.revision.chooseModel')} disabled={disabled || running}
        onChange={(value) => { invalidate(); setTargetIndex(value) }} />
      {!targets.length ? <Text style={{ color: colors.textSecondary }}>{t('documents.revision.noModels')}</Text> : null}
      <IsleButton label={t('documents.revision.refreshModels')} compact disabled={disabled || running} onPress={refreshTargets} />
      {target ? <Text selectable testID="document-revision-destination" style={{ color: colors.textSecondary }}>
        {t('documents.revision.destination', { model: target.upstreamModel, destination: target.destination })}
        {target.proxy ? `\n${t('documents.revision.proxy', { proxy: target.proxy === 'system' ? t('documents.revision.systemProxy') : target.proxy })}` : ''}
      </Text> : null}
      <IsleInput label={t('documents.revision.instruction')} accessibilityLabel={t('documents.revision.instruction')} testID="document-revision-instruction"
        value={instruction} multiline maxLength={DOCUMENT_REVISION_INSTRUCTION_LIMIT} editable={!disabled && !running}
        onChangeText={(value) => { invalidate(); setInstruction(value) }} />
      <Text selectable style={{ color: colors.textSecondary }}>{t('documents.revision.sourceNotice')}</Text>
      {citations.map((citation) => {
        const source = sources.get(citation.id)
        const oversized = !!source && source.text.length > DOCUMENT_REVISION_INPUT_LIMIT
        return <View key={citation.id} style={{ gap: 8 }}>
          <Text selectable style={{ color: colors.text, fontWeight: '600' }}>{citation.title}</Text>
          {citation.excerpt ? <Text selectable style={{ color: colors.textSecondary }}>{t('documents.revision.capturedExcerpt')} {citation.excerpt}</Text> : null}
          <IsleButton label={t(source ? 'documents.revision.refreshSource' : 'documents.revision.readSource')} disabled={disabled || running || !!reading}
            busy={reading === citation.id} onPress={() => void read(citation.id)} />
          {source ? <>
            <Text selectable style={{ color: colors.textSecondary }}>{selected.includes(citation.id) ? `[S${selected.indexOf(citation.id) + 1}] ` : ''}{t('documents.revision.currentSource', { title: source.title, time: new Date(source.updatedAt).toLocaleString() })}</Text>
            {source.updatedAt > (draft.origin?.messageTimestamp ?? 0) ? <Text style={{ color: colors.textSecondary }}>{t('source.updatedAfterResponse')}</Text> : null}
            <Text selectable testID={`document-revision-source-${citation.id}`} style={{ color: colors.text }}>{source.text.slice(0, DOCUMENT_REVISION_INPUT_LIMIT)}</Text>
            {oversized ? <Text style={{ color: colors.textSecondary }}>{t('documents.revision.inputTooLong')}</Text> :
              <IsleButton label={t(selected.includes(citation.id) ? 'documents.revision.removeSource' : 'documents.revision.addSource')}
                accessibilityLabel={t(selected.includes(citation.id) ? 'documents.revision.excludeSource' : 'documents.revision.includeSource', { title: source.title })}
                disabled={disabled || running} onPress={() => {
                  invalidate()
                  setSelected(selected.includes(citation.id) ? selected.filter((id) => id !== citation.id) : [...selected, citation.id])
                }} />}
          </> : null}
        </View>
      })}
      <Text style={{ color: colors.textSecondary }}>{t(selected.length ? 'documents.revision.selectedSources' : 'documents.revision.noSources', { count: selected.length })}</Text>
      {error ? <Text accessibilityRole="alert" style={{ color: colors.text }}>{t(`documents.revision.${error}`)}</Text> : null}
      {running ? <>
        <Text accessibilityLiveRegion="polite" style={{ color: colors.textSecondary }}>{t('documents.revision.generating')}</Text>
        <IsleButton label={t('common.cancel')} onPress={cancel} />
      </> : <IsleButton label={t('documents.revision.generate')} tone="primary" disabled={disabled || !instruction.trim() || !target || !!reading} onPress={() => void propose()} />}
      {proposal && proposal.base.draft === draft && proposal.base.saved === saved ? <View testID="document-revision-proposal" style={{ gap: 12 }}>
        <Text selectable style={{ color: colors.textSecondary }}>{t('documents.revision.reviewNotice', { model: `${proposal.target.providerName} · ${proposal.target.upstreamModel}`, count: proposal.sources.length })}</Text>
        {proposal.sources.map((source, index) => <Text key={source.citationId} selectable style={{ color: colors.textSecondary }}>[S{index + 1}] {source.title}</Text>)}
        <Text style={{ color: colors.text, fontWeight: '700' }}>{t('documents.revision.before')}</Text>
        <Text selectable testID="document-revision-before" style={{ color: colors.text }}>{proposal.base.draft.body}</Text>
        <Text style={{ color: colors.text, fontWeight: '700' }}>{t('documents.revision.proposed')}</Text>
        <Text selectable testID="document-revision-proposed" style={{ color: colors.text }}>{proposal.body}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <IsleButton label={t('documents.revision.accept')} tone="primary" disabled={disabled} onPress={() => void accept()} />
          <IsleButton label={t('documents.revision.reject')} disabled={disabled} onPress={() => setProposal(undefined)} />
        </View>
      </View> : null}
    </> : null}
  </View>
}
