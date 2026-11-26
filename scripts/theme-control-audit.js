const fs = require('node:fs')
const path = require('node:path')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default

const nativeControls = new Set(['Alert', 'ActionSheetIOS', 'ToastAndroid', 'ActivityIndicator', 'Button', 'Switch', 'Picker', 'ProgressBarAndroid', 'ProgressViewIOS'])
const webControls = new Set(['ActivityIndicator', 'Button', 'Picker', 'Switch', 'TextInput'])
const pickerControls = new Set(['Picker'])
const controlsByModule = new Map([
  ['react-native', nativeControls],
  ['react-native-web', webControls],
  ['@react-native-picker/picker', pickerControls],
])
const htmlControls = new Set(['button', 'input', 'textarea', 'select', 'progress', 'meter'])
const browserDialogs = new Set(['alert', 'confirm', 'prompt'])

function isImportedComponent(name, exported, sourcePattern, scope) {
  const member = name?.type === 'JSXMemberExpression'
  const local = member ? name.object : name
  if (local?.type !== 'JSXIdentifier') return false
  const binding = scope.getBinding(local.name)
  const specifier = binding?.path.node
  const declaration = binding?.path.parentPath.node
  if (declaration?.type !== 'ImportDeclaration' || declaration.importKind === 'type'
    || !sourcePattern.test(declaration.source.value)) return false
  return member
    ? specifier.type === 'ImportNamespaceSpecifier' && name.property.name === exported
    : specifier.type === 'ImportSpecifier' && specifier.importKind !== 'type' && (specifier.imported.name ?? specifier.imported.value) === exported
}

function auditThemeControls(source, file) {
  const ast = parser.parse(source, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx'] })
  const issues = []
  const namespaces = new Map()
  const moduleSourceForLoad = node => {
    if (node?.type === 'AwaitExpression') return moduleSourceForLoad(node.argument)
    if (node?.type === 'ImportExpression') return node.source?.value
    if (node?.type !== 'CallExpression') return undefined
    const isRequire = node.callee.type === 'Identifier' && node.callee.name === 'require'
    const isDynamicImport = node.callee.type === 'Import'
    return isRequire || isDynamicImport ? node.arguments[0]?.value : undefined
  }
  const add = (node, control) => issues.push({ file, line: node.loc.start.line, control })
  for (const node of ast.program.body) {
    if (node.type === 'TSImportEqualsDeclaration' && node.importKind !== 'type'
      && node.moduleReference.type === 'TSExternalModuleReference'
      && node.moduleReference.expression.type === 'StringLiteral'
      && controlsByModule.has(node.moduleReference.expression.value)) {
      namespaces.set(node.id.name, node.moduleReference.expression.value)
    }
    if (node.type !== 'ImportDeclaration' || node.importKind === 'type') continue
    const controls = controlsByModule.get(node.source.value)
    if (!controls) continue
    for (const specifier of node.specifiers) {
      if (specifier.type === 'ImportNamespaceSpecifier' || specifier.type === 'ImportDefaultSpecifier') namespaces.set(specifier.local.name, node.source.value)
      if (specifier.type === 'ImportSpecifier' && specifier.importKind !== 'type' && controls.has(specifier.imported.name)) add(specifier, specifier.imported.name)
      if (specifier.type === 'ImportDefaultSpecifier' && node.source.value === '@react-native-picker/picker') add(specifier, 'Picker')
    }
  }
  traverse(ast, {
    JSXOpeningElement(element) {
      const { node, scope } = element
      const button = isImportedComponent(node.name, 'IsleButton', /(?:^|\/)(?:isle(?:\/(?:index|Controls|IsleKit))?|Controls|IsleKit)(?:\.[jt]sx?)?$/, scope)
      const iconButton = isImportedComponent(node.name, 'IsleIconButton', /(?:^|\/)(?:isle(?:\/(?:index|Primitives))?|Primitives)(?:\.[jt]sx?)?$/, scope)
      const iconAttribute = button && element.get('attributes').find(attribute => attribute.node.type === 'JSXAttribute' && attribute.node.name.name === 'icon')
      const icons = button
        ? iconAttribute?.node.value?.type === 'JSXExpressionContainer' ? [iconAttribute.get('value.expression')] : []
        : iconButton ? element.parentPath.get('children') : []
      const inspect = icon => {
        for (const exported of ['AppIcon', 'AnimatedNavigationIcon']) {
          const iconSource = new RegExp('(?:^|/)' + exported + '(?:\\.[jt]sx?)?$')
          if (isImportedComponent(icon.node.openingElement.name, exported, iconSource, icon.scope)) {
            add(icon.node, (button ? 'IsleButton.icon' : 'IsleIconButton.children') + ' must render ' + exported + ' with the current foreground')
          }
        }
      }
      for (const child of icons) {
        const icon = child.isJSXExpressionContainer() ? child.get('expression') : child
        if (icon.isFunction()) continue
        if (icon.isJSXElement()) inspect(icon)
        icon.traverse({ Function(callback) { callback.skip() }, JSXElement: inspect })
      }
    },
    VariableDeclarator({ node }) {
      const moduleSource = moduleSourceForLoad(node.init)
      const controls = controlsByModule.get(moduleSource)
      if (!controls) return
      if (node.id.type === 'Identifier') namespaces.set(node.id.name, moduleSource)
      if (node.id.type === 'ObjectPattern') for (const property of node.id.properties) {
        if (property.type === 'ObjectProperty' && controls.has(property.key.name ?? property.key.value)) add(property, property.key.name ?? property.key.value)
      }
    },
    CallExpression(call) {
      const callee = call.node.callee
      if (callee.type === 'Identifier' && browserDialogs.has(callee.name) && !call.scope.getBinding(callee.name)) add(callee, callee.name)
    },
  })
  function visit(node) {
    if (!node || typeof node !== 'object') return
    if (node.type === 'JSXOpeningElement' && node.name.type === 'JSXIdentifier' && htmlControls.has(node.name.name)) add(node, '<' + node.name.name + '>')
    if (node.type === 'JSXOpeningElement' && node.name.type === 'JSXMemberExpression'
      && node.name.object.type === 'JSXIdentifier') {
      const moduleSource = namespaces.get(node.name.object.name)
      if (controlsByModule.get(moduleSource)?.has(node.name.property.name)) add(node, moduleSource + '.' + node.name.property.name)
    }
    if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
      const property = node.computed ? node.property.value : node.property.name
      if (node.object.type === 'Identifier') {
        const moduleSource = namespaces.get(node.object.name)
        if (controlsByModule.get(moduleSource)?.has(property)) add(node, moduleSource + '.' + property)
        if (['window', 'globalThis', 'global'].includes(node.object.name) && browserDialogs.has(property)) add(node, node.object.name + '.' + property)
      }
      const moduleSource = moduleSourceForLoad(node.object)
      if (controlsByModule.get(moduleSource)?.has(property)) add(node, moduleSource + '.' + property)
    }
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'start', 'end', 'tokens', 'comments'].includes(key)) continue
      if (Array.isArray(value)) value.forEach(visit)
      else if (value && typeof value === 'object') visit(value)
    }
  }
  visit(ast.program)
  return issues
}

function collectThemeControlIssues(root = path.resolve(__dirname, '..')) {
  const issues = []
  let checked = 0
  function walk(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name)
      if (item.isDirectory()) {
        if (!['__tests__', '__mocks__', 'node_modules'].includes(item.name)) walk(file)
      } else if (/\.[jt]sx?$/.test(item.name) && !/\.(test|spec|d)\.[jt]sx?$/.test(item.name)) {
        checked++
        issues.push(...auditThemeControls(fs.readFileSync(file, 'utf8'), path.relative(root, file).replaceAll('\\', '/')))
      }
    }
  }
  for (const directory of ['app', 'src']) walk(path.join(root, directory))
  return { checked, issues }
}

if (require.main === module) {
  const result = collectThemeControlIssues()
  for (const issue of result.issues) console.error(`${issue.file}:${issue.line} use an application theme component: ${issue.control}`)
  console.log(`theme control audit: ${result.checked} files, ${result.issues.length} issues`)
  if (result.issues.length) process.exitCode = 1
}
module.exports = { auditThemeControls, collectThemeControlIssues }
