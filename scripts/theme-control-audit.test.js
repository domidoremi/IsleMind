const { auditThemeControls } = require('./theme-control-audit')

it.each([
  ["import { ActivityIndicator as Waiting } from 'react-native'", 'ActivityIndicator'],
  ["import * as Native from 'react-native'; Native.Alert.alert('Delete')", 'react-native.Alert'],
  ["import RN from 'react-native'; RN['ToastAndroid'].show('Saved', 0)", 'react-native.ToastAndroid'],
  ["window.confirm('Delete')", 'window.confirm'],
  ["globalThis['prompt']('Name')", 'globalThis.prompt'],
  ["const { ActivityIndicator: Waiting } = require('react-native')", 'ActivityIndicator'],
  ["const Native = require('react-native'); Native.Switch", 'react-native.Switch'],
  ["import * as Native from 'react-native'; const control = <Native.Switch />", 'react-native.Switch'],
  ["import Native from 'react-native'; const control = <Native.Button title='Save' />", 'react-native.Button'],
  ["const Native = require('react-native'); const control = <Native.ActivityIndicator />", 'react-native.ActivityIndicator'],
  ["confirm('Delete')", 'confirm'],
  ['const control = <select><option>One</option></select>', '<select>'],
])('rejects default controls including aliased and namespace imports: %s', (source, control) => {
  expect(auditThemeControls(source, 'fixture.tsx')).toContainEqual({ file: 'fixture.tsx', line: 1, control })
})

it('reports a namespace control once for an opening and closing pair', () => {
  expect(auditThemeControls("import * as Native from 'react-native'; const control = <Native.Button>Save</Native.Button>", 'fixture.tsx'))
    .toEqual([{ file: 'fixture.tsx', line: 1, control: 'react-native.Button' }])
})

it('allows theme namespaces and native layout or text hosts', () => {
  expect(auditThemeControls(`import * as Native from 'react-native';
    import * as Theme from '@/components/ui/isle';
    const control = <Native.View><Theme.Button /><Native.TextInput /></Native.View>`, 'fixture.tsx')).toEqual([])
})

it('keeps native text hosts, type-only references and application controls available', () => {
  expect(auditThemeControls(`import { View, type Switch } from 'react-native';
    import type { ActivityIndicator } from 'react-native';
    import { AppLoadingIndicator } from '@/components/ui/AppLoadingIndicator';
    const confirm = () => true; confirm();
    const control = <View><AppLoadingIndicator /></View>`, 'fixture.tsx')).toEqual([])
})

it.each([
  "import { IsleButton } from '@/components/ui/isle'; import { AppIcon } from '@/components/ui/AppIcon'; const view = <IsleButton icon={<AppIcon name='check' color={colors.text} />} />",
  "import { IsleButton as Action } from '@/components/ui/isle/Controls'; import { AppIcon as Icon } from '@/components/ui/AppIcon'; const view = <Action icon={<Icon name='check' color={colors.text} />} />",
  "import * as Theme from '@/components/ui/isle'; import * as Icons from '@/components/ui/AppIcon'; const view = <Theme.IsleButton icon={<Icons.AppIcon name='check' color={colors.text} />} />",
])('requires standard action icons to inherit the button state: %s', source => {
  expect(auditThemeControls(source, 'fixture.tsx')).toEqual([
    { file: 'fixture.tsx', line: 1, control: 'IsleButton.icon must render AppIcon with the current foreground' },
  ])
})

it('allows state-aware action icons and independently colored brand content', () => {
  expect(auditThemeControls(`import { IsleButton } from '@/components/ui/isle';
    import { AppIcon } from '@/components/ui/AppIcon';
    const actions = <><IsleButton icon={foreground => <AppIcon name='check' color={foreground} />} />
      <IsleButton icon={<BrandLogo />} /></>`, 'fixture.tsx')).toEqual([])
})

it('does not mistake shadowed components for the themed button', () => {
  expect(auditThemeControls(`import { IsleButton } from '@/components/ui/isle';
    import { AppIcon } from '@/components/ui/AppIcon';
    function Preview({ IsleButton }) { return <IsleButton icon={<AppIcon color='red' />} /> }`, 'fixture.tsx')).toEqual([])
})

it('keeps animated navigation glyphs on the current action foreground', () => {
  const imports = "import { IsleButton } from '@/components/ui/isle'; import { AnimatedNavigationIcon as Back } from '@/components/navigation/AnimatedNavigationIcon';"
  expect(auditThemeControls(imports + "const button = <IsleButton icon={<Back color={colors.text} />} />", 'fixture.tsx'))
    .toEqual([{ file: 'fixture.tsx', line: 1, control: 'IsleButton.icon must render AnimatedNavigationIcon with the current foreground' }])
  expect(auditThemeControls(imports + "const button = <IsleButton icon={foreground => <Back color={foreground} />} />", 'fixture.tsx')).toEqual([])
})

it.each([
  "import { IsleIconButton } from '@/components/ui/isle'; import { AppIcon } from '@/components/ui/AppIcon'; const view = <IsleIconButton><AppIcon name='close' color={colors.text} /></IsleIconButton>",
  "import { IsleIconButton as Action } from '@/components/ui/isle/Primitives'; import { AppIcon as Icon } from '@/components/ui/AppIcon'; const view = <Action><Icon name='close' color={colors.text} /></Action>",
  "import * as Theme from '@/components/ui/isle'; import * as Icons from '@/components/ui/AppIcon'; const view = <Theme.IsleIconButton><Icons.AppIcon name='close' color={colors.text} /></Theme.IsleIconButton>",
])('keeps icon-only action glyphs on the current foreground: %s', source => {
  expect(auditThemeControls(source, 'fixture.tsx')).toEqual([
    { file: 'fixture.tsx', line: 1, control: 'IsleIconButton.children must render AppIcon with the current foreground' },
  ])
})

it('allows state-aware icon-only actions, brand content and shadowed component names', () => {
  expect(auditThemeControls(`import { IsleIconButton } from '@/components/ui/isle';
    import { AppIcon } from '@/components/ui/AppIcon';
    const actions = <><IsleIconButton>{foreground => <AppIcon color={foreground} />}</IsleIconButton>
      <IsleIconButton><BrandLogo /></IsleIconButton></>;
    function Preview({ IsleIconButton }) { return <IsleIconButton><AppIcon color='red' /></IsleIconButton> }`, 'fixture.tsx')).toEqual([])
})

it.each([
  ['<View><AppIcon color={colors.text} /></View>', 1],
  ['enabled ? <AppIcon color={colors.text} /> : <AppIcon color={colors.textSecondary} />', 2],
  ['<><AppIcon color={colors.text} /></>', 1],
  ['[<AppIcon key="status" color={colors.text} />]', 1],
])('requires wrapped and conditional action icons to inherit state: %s', (icon, count) => {
  const imports = "import { IsleButton } from '@/components/ui/isle'; import { AppIcon } from '@/components/ui/AppIcon';"
  expect(auditThemeControls(imports + `const action = <IsleButton icon={${icon}} />`, 'fixture.tsx'))
    .toEqual(Array.from({ length: count }, () => ({ file: 'fixture.tsx', line: 1,
      control: 'IsleButton.icon must render AppIcon with the current foreground' })))
})

it('requires wrapped icon-only actions to inherit state through aliases and namespaces', () => {
  expect(auditThemeControls(`import * as Theme from '@/components/ui/isle';
    import { AppIcon as Icon } from '@/components/ui/AppIcon';
    const action = <Theme.IsleIconButton><View><Icon color={colors.text} /></View></Theme.IsleIconButton>`, 'fixture.tsx'))
    .toEqual([{ file: 'fixture.tsx', line: 3, control: 'IsleIconButton.children must render AppIcon with the current foreground' }])
})

it('allows state-aware wrapped icons and ignores shadowed nested icon components', () => {
  expect(auditThemeControls(`import { IsleButton, IsleIconButton } from '@/components/ui/isle';
    import { AppIcon } from '@/components/ui/AppIcon';
    const action = <IsleButton icon={foreground => <View><AppIcon color={foreground} /></View>} />;
    const close = <IsleIconButton>{foreground => <View><AppIcon color={foreground} /></View>}</IsleIconButton>;
    function Preview({ AppIcon }) { return <IsleButton icon={<View><AppIcon color='red' /></View>} /> }`, 'fixture.tsx'))
    .toEqual([])
})
