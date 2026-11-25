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
