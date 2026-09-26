import { render } from '@testing-library/react-native'
import { StyleSheet, Text, View } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'
import { getColors } from '@/theme/colors'
import type { McpServerConfig } from '@/types/mcpContracts'
import { LiquidGlassProviderSettingsExperience } from '@/components/providers/theme-experiences/ProviderSettingsExperiences'
import { LiquidGlassContextSettingsLead } from './ContextSettingsExperiences'
import { LiquidGlassMcpSettingsExperience } from './McpSettingsExperiences'
import { LiquidGlassPreferenceSettingsExperience } from './PreferenceSettingsExperiences'
import { LiquidGlassSkillSettingsLead } from './SkillSettingsExperiences'

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: { strong: 2 } }))
jest.mock('@/components/ui/isle', () => ({ IslePressable: require('react-native').Pressable }))

const server: McpServerConfig = {
  id: 'sample', name: 'Server', url: 'https://example.invalid/mcp', transport: 'sse',
  enabled: false, status: 'disconnected', manifestTtlMs: 0, tools: [], resources: [],
  prompts: [], approvedToolNames: [], createdAt: 0, updatedAt: 0,
}

// These are native style/ownership regressions, not a simulated Android GPU.
it.each([
  ['light', true], ['light', false], ['dark', true], ['dark', false],
] as const)('keeps %s settings shadows outside rounded shells (compact=%s)', async (mode, compact) => {
  const colors = getColors(mode, 'liquid-glass')
  jest.mocked(useAppTheme).mockReturnValue({
    colors, design: colors.design!, canonicalThemeId: 'liquid-glass', isLiquidGlass: true,
  } as ReturnType<typeof useAppTheme>)
  const noop = () => undefined
  const tree = (expanded: boolean) => <View testID="pages">
    <LiquidGlassPreferenceSettingsExperience
      compact={compact}
      labels={{ identity: 'Identity', generation: 'Generation', interaction: 'Interaction', workflow: 'Workflow' }}
      identity={<View testID="identity-content" style={{ minHeight: expanded ? 220 : 100 }}><Text>Identity content</Text></View>}
      generation={<Text>Generation content</Text>}
      interaction={<Text>Interaction content</Text>}
      workflow={<Text>Workflow content</Text>}
    />
    <LiquidGlassContextSettingsLead section="all" compact={compact} toggles={<Text>Context content</Text>} />
    <LiquidGlassSkillSettingsLead saved={0} workflows={0} enabledWorkflows={0} templates={0} review={0} focused={false} summary={<Text>Skills content</Text>} />
    <LiquidGlassProviderSettingsExperience
      title="Providers" subtitle="Setup" backLabel="Back" addLabel="Add" importLabel="Import"
      enabledSummary="None" visibleSummary="None" enabledCount={0} totalCount={0} visibleCount={0}
      compact={compact} onBack={noop} onAdd={noop} onImport={noop}
    ><Text>Provider content</Text></LiquidGlassProviderSettingsExperience>
    <LiquidGlassMcpSettingsExperience compact={compact} managementOpen={false} managementTrigger={null} management={null}
      servers={[server, { ...server, id: 'enabled', enabled: true }]} pendingServerId={null} onToggle={noop} onOpenDetails={noop} />
  </View>
  const screen = await render(tree(false))
  const content = screen.getByTestId('identity-content')
  for (const expanded of [false, true, false]) {
    await screen.rerender(tree(expanded))
    expect(screen.getByTestId('identity-content')).toBe(content)
    expect(content).toHaveStyle({ minHeight: expanded ? 220 : 100 })
    const root = screen.getByTestId('pages')
    const legacyShadows = root.queryAll(node => {
      const style = StyleSheet.flatten(node.props.style)
      return (style?.elevation ?? 0) > 0 || (style?.shadowOpacity ?? 0) > 0
    })
    expect(legacyShadows).toHaveLength(0)
    const shells = root.queryAll(node => {
      const shadow = StyleSheet.flatten(node.props.style)?.boxShadow
      return !!shadow && shadow !== 'none'
    })
    expect(shells).toHaveLength(10)
    // Every shell uses the shared material, not merely a translucent View.
    expect(screen.getAllByTestId('glass-material', { includeHiddenElements: true })).toHaveLength(10)
    for (const shell of shells) {
      const style = StyleSheet.flatten(shell.props.style)
      expect(style).toMatchObject({ borderRadius: colors.design!.semantic.radius.extraLarge, elevation: 0, shadowOpacity: 0 })
      expect(style.backgroundColor).toBe('transparent')
      expect(style.overflow).toBe('hidden')
      expect(style.boxShadow).not.toContain('inset')
    }
  }
})
