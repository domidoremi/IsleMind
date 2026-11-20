import { render, within } from '@testing-library/react-native'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { ScenePlanPreview } from './ScenePlanPreview'
import type { ModelRoutingPlan, ScenePlan } from '@/core'
import type { Conversation } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { ScenePlanPreview as Preview } from './scenePlanWorkspacePort'
import zhCN from '@/i18n/resources/zh-CN.json'
import en from '@/i18n/resources/en.json'
import ja from '@/i18n/resources/ja.json'

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({
  colors: jest.requireActual('@/theme/colors').getColors('light', 'minimal'),
}) }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('@/presentation/layout/WorkspaceSurface', () => ({ WorkspaceSurface: ({ children, role, ...props }: any) => {
  const { View } = jest.requireActual('react-native')
  return <View {...props}>{children}</View>
} }))
jest.mock('@/components/ui/isle', () => {
  const { Pressable, Text } = jest.requireActual('react-native')
  return { IslePressable: Pressable, IsleButton: ({ label, busy, disabled, ...props }: any) =>
    <Pressable {...props} disabled={busy || disabled}><Text>{label}</Text></Pressable> }
})

const providers: AIProvider[] = ['a', 'b'].map(id => ({ id, name: `Connection ${id.toUpperCase()}`,
  type: 'openai', apiKey: '', enabled: true, models: ['shared-model'] }))
const members = providers.map(provider => ({ providerId: provider.id, model: 'shared-model' }))
const group: ModelRoutingPlan = { schema: 'islemind.model-routing-plan.v1', id: 'group', name: 'Saved group',
  mode: 'group', primary: members[0], group: { model: 'shared-model', strategy: 'priority', members }, crossProvider: 'ask' }
const scene: ScenePlan = { schema: 'islemind.scene-plan.v1', id: 'scene', name: 'Scene', revision: 1, configuration: {} }
const conversation: Conversation = { id: 'conversation', title: 'Work', providerId: 'a', model: 'shared-model',
  systemPrompt: '', temperature: 0.6, maxTokens: 1000, messages: [], createdAt: 1, updatedAt: 1 }

const expectedRouting = {
  "zh-CN": {
    "group": "同模型路由组",
    "strategyName": {
      "priority": "顺序优先",
      "round-robin": "连接轮换",
      "health-first": "健康优先"
    }
  },
  "en": {
    "group": "Same-model group",
    "strategyName": {
      "priority": "In order",
      "round-robin": "Rotate connections",
      "health-first": "Health first"
    }
  },
  "ja": {
    "group": "同一モデルグループ",
    "strategyName": {
      "priority": "順序優先",
      "round-robin": "接続を順番に",
      "health-first": "稼働状況優先"
    }
  }
} as const

describe.each([['zh-CN', zhCN], ['en', en], ['ja', ja]] as const)('scene routing review in %s', (language, resource) => {
  const translation = createInstance()
  beforeAll(async () => {
    await translation.init({ lng: language, fallbackLng: false, resources: { [language]: { translation: resource } },
      interpolation: { escapeValue: false } })
  })
  async function review(before: ModelRoutingPlan | undefined, after: ModelRoutingPlan | undefined) {
    const preview: Preview = { plan: scene, target: { kind: 'conversation', conversationId: conversation.id },
      before: { ...conversation, routingPlan: before }, after: { ...conversation, routingPlan: after },
      changes: [{ field: 'routingPlan', before, after, changed: true }],
      catalog: { skills: [], skillVariables: {}, tools: [], knowledge: [] }, issues: [], warnings: [], previewedAt: 1 }
    const apply = jest.fn()
    const view = await render(<I18nextProvider i18n={translation}><ScenePlanPreview preview={preview} providers={providers}
      threshold={0.8} declarationMode="full" stale={false} busy={false} onApply={apply} onRefresh={() => undefined} /></I18nextProvider>)
    expect(apply).not.toHaveBeenCalled()
    return within(view.getByTestId('scene-change-routingPlan'))
  }

  it.each(['round-robin', 'health-first'] as const)('distinguishes a strategy-only change to %s before applying', async strategy => {
    const after: ModelRoutingPlan = { ...group, group: { ...group.group!, strategy } }
    const row = await review(group, after)
    const originalText = row.getByText(expectedRouting[language].strategyName.priority, { exact: false })
    const changedText = row.getByText(expectedRouting[language].strategyName[strategy], { exact: false })
    expect(originalText).not.toBe(changedText)
    for (const text of [originalText, changedText]) {
      expect(text).toHaveTextContent(/Connection A · shared-model/)
      expect(text).toHaveTextContent(/Connection B · shared-model/)
      expect(text).toHaveTextContent(new RegExp(resource.routing.ask))
    }
  })

  it('shows every member of a newly applied group with its strategy and cross-provider rule', async () => {
    const row = await review(undefined, group)
    expect(row.getByText(expectedRouting[language].strategyName.priority, { exact: false }))
      .toHaveTextContent(/Connection B · shared-model/)
    expect(row.getByText('Saved group', { exact: false })).toHaveTextContent(new RegExp(expectedRouting[language].group))
  })

  it('keeps fixed and fallback model identities and consent visible', async () => {
    const before: ModelRoutingPlan = { schema: group.schema, id: 'fixed', name: 'Fixed plan', mode: 'fixed', primary: members[0], crossProvider: 'ask' }
    const after: ModelRoutingPlan = { ...before, id: 'fallback', name: 'Fallback plan', mode: 'fallback', backup: members[1], crossProvider: 'allow' }
    const row = await review(before, after)
    expect(row.getByText('Fixed plan', { exact: false })).toHaveTextContent(/Connection A · shared-model/)
    expect(row.getByText('Fallback plan', { exact: false })).toHaveTextContent(/Connection A · shared-model → Connection B · shared-model/)
    expect(row.getByText('Fallback plan', { exact: false })).toHaveTextContent(new RegExp(resource.routing.allow))
    for (const strategy of Object.values(expectedRouting[language].strategyName)) expect(row.queryByText(strategy, { exact: false })).toBeNull()
  })
})
