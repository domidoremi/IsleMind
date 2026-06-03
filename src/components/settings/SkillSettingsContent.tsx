import { useEffect, useMemo, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { Download, FileJson, Pencil, Plus, Sparkles, Trash2, Upload } from 'lucide-react-native'
import { useTranslation } from 'react-i18next'
import { IsleButton } from '@/components/ui/isle'
import { useIsleDialog } from '@/components/ui/isle'
import { IsleField, IsleListItem, IsleSection } from '@/components/ui/isle'
import { IsleChip } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { createBaseSkill, deleteSkill, exportSkill, importSkill, listSkills, upsertSkill } from '@/services/skills'
import type { SkillDefinition, SkillLayer, SkillStackPolicy } from '@/types'

const SKILL_LAYERS: SkillLayer[] = ['base', 'advanced', 'adaptive']
const STACK_POLICIES: SkillStackPolicy[] = ['append', 'override']

export function SkillSettingsContent() {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const [skills, setSkills] = useState<SkillDefinition[]>([])
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [tags, setTags] = useState('')
  const [layer, setLayer] = useState<SkillLayer>('base')
  const [priority, setPriority] = useState('')
  const [providerId, setProviderId] = useState('')
  const [model, setModel] = useState('')
  const [temperature, setTemperature] = useState('')
  const [maxTokens, setMaxTokens] = useState('')
  const [enabledTools, setEnabledTools] = useState('')
  const [knowledgeSources, setKnowledgeSources] = useState('')
  const [firstUserMessage, setFirstUserMessage] = useState('')
  const [expectedReplyFormat, setExpectedReplyFormat] = useState('')
  const [variablesJson, setVariablesJson] = useState('')
  const [stackPolicy, setStackPolicy] = useState<SkillStackPolicy>('append')
  const sortedSkills = useMemo(() => [...skills].sort((a, b) => b.updatedAt - a.updatedAt), [skills])

  useEffect(() => {
    void refresh()
  }, [])

  async function refresh() {
    setSkills(await listSkills())
  }

  async function saveSkill() {
    const prompt = systemPrompt.trim()
    if (!prompt) {
      dialog.toast({ title: t('skills.promptRequired'), tone: 'amber' })
      return
    }
    const editing = editingSkillId ? skills.find((skill) => skill.id === editingSkillId) : undefined
    const parsedVariables = parseVariablesJson(variablesJson)
    if (parsedVariables === null) {
      dialog.toast({ title: t('skills.variablesInvalid'), tone: 'amber' })
      return
    }
    const nextPriority = parseBoundedNumber(priority, -1000, 1000) ?? (layer === 'base' ? 0 : layer === 'advanced' ? 20 : 40)
    const skill = await upsertSkill(createBaseSkill({
      id: editing?.id,
      createdAt: editing?.createdAt,
      version: editing?.version,
      name: name.trim() || t('skills.untitled'),
      description: optionalText(description),
      layer,
      systemPrompt: prompt,
      tags: parseList(tags),
      priority: nextPriority,
      providerId: optionalText(providerId),
      model: optionalText(model),
      temperature: parseBoundedNumber(temperature, 0, 2),
      maxTokens: parseBoundedNumber(maxTokens, 128, 128000),
      enabledTools: parseList(enabledTools),
      knowledgeSources: parseList(knowledgeSources),
      firstUserMessage: optionalText(firstUserMessage),
      expectedReplyFormat: optionalText(expectedReplyFormat),
      variables: parsedVariables,
      stackPolicy,
    }))
    resetForm()
    await refresh()
    dialog.toast({ title: editing ? t('skills.updated') : t('skills.created'), message: skill.name, tone: 'mint' })
  }

  async function importFromClipboard() {
    const raw = await Clipboard.getStringAsync()
    await importRaw(raw)
  }

  async function importFromFile() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/json', 'text/json', 'text/plain', '*/*'],
      copyToCacheDirectory: true,
    })
    if (result.canceled || !result.assets[0]) return
    const asset = result.assets[0]
    const supported = /\.isleskill$/i.test(asset.name) || /\.(json|txt)$/i.test(asset.name) || ['application/json', 'text/json', 'text/plain'].includes(asset.mimeType ?? '')
    if (!supported) {
      dialog.toast({ title: t('skills.unsupportedFile'), message: '.isleskill / .json / .txt', tone: 'amber' })
      return
    }
    const raw = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.UTF8 })
    await importRaw(raw)
  }

  async function importRaw(raw: string) {
    const result = importSkill(raw)
    if (!result.ok || !result.skill) {
      dialog.notice({ title: t('skills.importFailed'), message: result.message, tone: 'danger' })
      return
    }
    await upsertSkill(result.skill)
    await refresh()
    dialog.toast({ title: t('skills.imported'), message: result.skill.name, tone: 'mint' })
  }

  async function exportSkillFile(skill: SkillDefinition) {
    const raw = exportSkill(skill)
    await Clipboard.setStringAsync(raw)
    const safeName = skill.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || skill.id
    const uri = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}${safeName}.isleskill`
    await FileSystem.writeAsStringAsync(uri, raw, { encoding: FileSystem.EncodingType.UTF8 })
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/json',
        dialogTitle: `${skill.name}.isleskill`,
        UTI: 'public.json',
      })
    }
    dialog.toast({ title: t('skills.exported'), message: `${skill.name}.isleskill`, tone: 'mint' })
  }

  async function removeSkill(skill: SkillDefinition) {
    const confirmed = await dialog.confirm({
      title: t('skills.deleteTitle'),
      message: skill.name,
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      tone: 'danger',
    })
    if (!confirmed) return
    await deleteSkill(skill.id)
    if (editingSkillId === skill.id) resetForm()
    await refresh()
    dialog.toast({ title: t('skills.deleted'), message: skill.name, tone: 'mint' })
  }

  function editSkill(skill: SkillDefinition) {
    setEditingSkillId(skill.id)
    setName(skill.name)
    setDescription(skill.description ?? '')
    setSystemPrompt(skill.systemPrompt)
    setTags(skill.tags.join(', '))
    setLayer(skill.layer)
    setPriority(String(skill.priority ?? ''))
    setProviderId(skill.providerId ?? '')
    setModel(skill.model ?? '')
    setTemperature(typeof skill.temperature === 'number' ? String(skill.temperature) : '')
    setMaxTokens(typeof skill.maxTokens === 'number' ? String(skill.maxTokens) : '')
    setEnabledTools((skill.enabledTools ?? []).join('\n'))
    setKnowledgeSources((skill.knowledgeSources ?? []).join('\n'))
    setFirstUserMessage(skill.firstUserMessage ?? '')
    setExpectedReplyFormat(skill.expectedReplyFormat ?? '')
    setVariablesJson(skill.variables?.length ? JSON.stringify(skill.variables, null, 2) : '')
    setStackPolicy(skill.stackPolicy ?? 'append')
  }

  function resetForm() {
    setEditingSkillId(null)
    setName('')
    setDescription('')
    setSystemPrompt('')
    setTags('')
    setLayer('base')
    setPriority('')
    setProviderId('')
    setModel('')
    setTemperature('')
    setMaxTokens('')
    setEnabledTools('')
    setKnowledgeSources('')
    setFirstUserMessage('')
    setExpectedReplyFormat('')
    setVariablesJson('')
    setStackPolicy('append')
  }

  return (
    <View style={{ gap: 12 }}>
      <IsleSection
        title={editingSkillId ? t('skills.edit') : t('skills.create')}
        subtitle={t('skills.createSubtitle')}
        action={<Sparkles color={colors.textSecondary} size={18} />}
      >
        <View style={{ gap: 10 }}>
          <IsleField label={t('skills.name')} inputProps={{ value: name, onChangeText: setName, placeholder: t('skills.namePlaceholder') }} />
          <IsleField label={t('skills.description')} inputProps={{ value: description, onChangeText: setDescription, placeholder: t('skills.descriptionPlaceholder') }} />
          <IsleField
            label={t('skills.systemPrompt')}
            inputProps={{ value: systemPrompt, onChangeText: setSystemPrompt, placeholder: t('skills.promptPlaceholder'), multiline: true, style: { minHeight: 112 } }}
          />
          <IsleField label={t('skills.tags')} inputProps={{ value: tags, onChangeText: setTags, placeholder: 'review, zh-CN' }} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <IsleField style={{ flex: 1 }} label={t('skills.priority')} inputProps={{ value: priority, onChangeText: setPriority, placeholder: '20', keyboardType: 'numeric' }} />
            <IsleField style={{ flex: 1 }} label={t('skills.temperature')} inputProps={{ value: temperature, onChangeText: setTemperature, placeholder: '0.3', keyboardType: 'decimal-pad' }} />
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <IsleField style={{ flex: 1 }} label={t('skills.providerId')} inputProps={{ value: providerId, onChangeText: setProviderId, placeholder: 'provider-id' }} />
            <IsleField style={{ flex: 1 }} label={t('skills.model')} inputProps={{ value: model, onChangeText: setModel, placeholder: 'model-id' }} />
          </View>
          <IsleField label={t('skills.maxTokens')} inputProps={{ value: maxTokens, onChangeText: setMaxTokens, placeholder: '4096', keyboardType: 'numeric' }} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {SKILL_LAYERS.map((item) => (
              <IsleButton key={item} label={t(`skills.layer.${item}`)} compact tone={layer === item ? 'mint' : 'soft'} onPress={() => setLayer(item)} />
            ))}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {STACK_POLICIES.map((item) => (
              <IsleButton key={item} label={t(`skills.stackPolicy.${item}`)} compact tone={stackPolicy === item ? 'mint' : 'soft'} onPress={() => setStackPolicy(item)} />
            ))}
          </ScrollView>
          <IsleField
            label={t('skills.enabledTools')}
            note={t('skills.listFieldNote')}
            inputProps={{ value: enabledTools, onChangeText: setEnabledTools, placeholder: 'islemind-builtins:search_web', multiline: true, style: { minHeight: 72 } }}
          />
          <IsleField
            label={t('skills.knowledgeSources')}
            note={t('skills.listFieldNote')}
            inputProps={{ value: knowledgeSources, onChangeText: setKnowledgeSources, placeholder: 'project-docs', multiline: true, style: { minHeight: 72 } }}
          />
          <IsleField
            label={t('skills.firstUserMessage')}
            inputProps={{ value: firstUserMessage, onChangeText: setFirstUserMessage, placeholder: t('skills.firstUserMessagePlaceholder'), multiline: true, style: { minHeight: 72 } }}
          />
          <IsleField
            label={t('skills.expectedReplyFormat')}
            inputProps={{ value: expectedReplyFormat, onChangeText: setExpectedReplyFormat, placeholder: t('skills.expectedReplyFormatPlaceholder'), multiline: true, style: { minHeight: 72 } }}
          />
          <IsleField
            label={t('skills.variables')}
            note={t('skills.variablesJsonNote')}
            inputProps={{ value: variablesJson, onChangeText: setVariablesJson, placeholder: '[{\"name\":\"topic\",\"type\":\"text\"}]', multiline: true, style: { minHeight: 92 } }}
          />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {editingSkillId ? <IsleButton label={t('common.cancel')} onPress={resetForm} style={{ flex: 1 }} /> : null}
            <IsleButton label={t('skills.saveSkill')} icon={<Plus color={colors.surface} size={16} />} tone="primary" onPress={() => void saveSkill()} style={{ flex: 1 }} />
          </View>
        </View>
      </IsleSection>

      <IsleSection title={t('skills.importExport')}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <IsleButton label={t('skills.importClipboard')} icon={<Upload color={colors.textSecondary} size={16} />} onPress={() => void importFromClipboard()} style={{ flex: 1 }} />
          <IsleButton label={t('settings.chooseFile')} icon={<FileJson color={colors.textSecondary} size={16} />} onPress={() => void importFromFile()} style={{ flex: 1 }} />
        </View>
      </IsleSection>

      <IsleSection title={`${t('skills.saved')} ${sortedSkills.length}`}>
        <View style={{ gap: 8 }}>
          {sortedSkills.map((skill) => (
            <IsleListItem
              key={skill.id}
              title={skill.name}
              description={skill.description || skill.systemPrompt}
              leading={<IsleChip active>{t(`skills.layer.${skill.layer}`)}</IsleChip>}
              trailing={
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <IsleButton label={t('common.edit')} compact icon={<Pencil color={colors.textSecondary} size={14} />} onPress={() => editSkill(skill)} />
                  <IsleButton label={t('common.share')} compact icon={<Download color={colors.textSecondary} size={14} />} onPress={() => void exportSkillFile(skill)} />
                  <IsleButton label={t('common.delete')} compact tone="danger" icon={<Trash2 color={colors.error} size={14} />} onPress={() => void removeSkill(skill)} />
                </View>
              }
            />
          ))}
          {!sortedSkills.length ? <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '800' }}>{t('skills.empty')}</Text> : null}
        </View>
      </IsleSection>
    </View>
  )
}

function optionalText(value: string): string | undefined {
  const text = value.trim()
  return text || undefined
}

function parseList(value: string): string[] | undefined {
  const items = value.split(/[\n,，]+/).map((item) => item.trim()).filter(Boolean)
  return items.length ? items : undefined
}

function parseBoundedNumber(value: string, min: number, max: number): number | undefined {
  const text = value.trim()
  if (!text) return undefined
  const parsed = Number(text)
  if (!Number.isFinite(parsed)) return undefined
  return Math.max(min, Math.min(max, parsed))
}

function parseVariablesJson(value: string): SkillDefinition['variables'] | null | undefined {
  const text = value.trim()
  if (!text) return undefined
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed as SkillDefinition['variables'] : null
  } catch {
    return null
  }
}
