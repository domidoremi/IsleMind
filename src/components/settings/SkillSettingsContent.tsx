import { useEffect, useMemo, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { Download, FileJson, Plus, Sparkles, Trash2, Upload } from 'lucide-react-native'
import { useTranslation } from 'react-i18next'
import { IsleButton } from '@/components/ui/isle'
import { useIsleDialog } from '@/components/ui/isle'
import { IsleField, IsleListItem, IsleSection } from '@/components/ui/isle'
import { IsleChip } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { createBaseSkill, deleteSkill, exportSkill, importSkill, listSkills, upsertSkill } from '@/services/skills'
import type { SkillDefinition, SkillLayer } from '@/types'

export function SkillSettingsContent() {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const [skills, setSkills] = useState<SkillDefinition[]>([])
  const [name, setName] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [tags, setTags] = useState('')
  const [layer, setLayer] = useState<SkillLayer>('base')
  const sortedSkills = useMemo(() => [...skills].sort((a, b) => b.updatedAt - a.updatedAt), [skills])

  useEffect(() => {
    void refresh()
  }, [])

  async function refresh() {
    setSkills(await listSkills())
  }

  async function createSkill() {
    const prompt = systemPrompt.trim()
    if (!prompt) {
      dialog.toast({ title: t('skills.promptRequired'), tone: 'amber' })
      return
    }
    const skill = await upsertSkill(createBaseSkill({
      name: name.trim() || t('skills.untitled'),
      layer,
      systemPrompt: prompt,
      tags: tags.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean),
      priority: layer === 'base' ? 0 : layer === 'advanced' ? 20 : 40,
    }))
    setName('')
    setSystemPrompt('')
    setTags('')
    setLayer('base')
    await refresh()
    dialog.toast({ title: t('skills.created'), message: skill.name, tone: 'mint' })
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
    await refresh()
    dialog.toast({ title: t('skills.deleted'), message: skill.name, tone: 'mint' })
  }

  return (
    <View style={{ gap: 12 }}>
      <IsleSection
        title={t('skills.create')}
        subtitle={t('skills.createSubtitle')}
        action={<Sparkles color={colors.textSecondary} size={18} />}
      >
        <View style={{ gap: 10 }}>
          <IsleField label={t('skills.name')} inputProps={{ value: name, onChangeText: setName, placeholder: t('skills.namePlaceholder') }} />
          <IsleField
            label={t('skills.systemPrompt')}
            inputProps={{ value: systemPrompt, onChangeText: setSystemPrompt, placeholder: t('skills.promptPlaceholder'), multiline: true, style: { minHeight: 112 } }}
          />
          <IsleField label={t('skills.tags')} inputProps={{ value: tags, onChangeText: setTags, placeholder: 'review, zh-CN' }} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {(['base', 'advanced', 'adaptive'] satisfies SkillLayer[]).map((item) => (
              <IsleButton key={item} label={t(`skills.layer.${item}`)} compact tone={layer === item ? 'mint' : 'soft'} onPress={() => setLayer(item)} />
            ))}
          </ScrollView>
          <IsleButton label={t('skills.saveSkill')} icon={<Plus color={colors.surface} size={16} />} tone="primary" onPress={() => void createSkill()} />
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
