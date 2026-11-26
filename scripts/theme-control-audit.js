const fs = require('node:fs')
const path = require('node:path')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default

const nativeControls = new Set(['Alert', 'ActionSheetIOS', 'ToastAndroid', 'ActivityIndicator', 'Button', 'Switch', 'Picker', 'ProgressBarAndroid', 'ProgressViewIOS'])
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
  const namespaces = new Set()
  const isNativeRequire = node => node?.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require' && node.arguments[0]?.value === 'react-native'
  const add = (node, control) => issues.push({ file, line: node.loc.start.line, control })
  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration' || node.importKind === 'type') continue
    if (node.source.value === 'react-native') {
      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportNamespaceSpecifier' || specifier.type === 'ImportDefaultSpecifier') namespaces.add(specifier.local.name)
        if (specifier.type === 'ImportSpecifier' && specifier.importKind !== 'type' && nativeControls.has(specifier.imported.name)) add(specifier, specifier.imported.name)
      }
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
      if (!isNativeRequire(node.init)) return
      if (node.id.type === 'Identifier') namespaces.add(node.id.name)
      if (node.id.type === 'ObjectPattern') for (const property of node.id.properties) {
        if (property.type === 'ObjectProperty' && nativeControls.has(property.key.name ?? property.key.value)) add(property, property.key.name ?? property.key.value)
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
      && node.name.object.type === 'JSXIdentifier' && namespaces.has(node.name.object.name)
      && nativeControls.has(node.name.property.name)) add(node, 'react-native.' + node.name.property.name)
    if ((node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') && node.object.type === 'Identifier') {
      const property = node.computed ? node.property.value : node.property.name
      if (namespaces.has(node.object.name) && nativeControls.has(property)) add(node, 'react-native.' + property)
      if (['window', 'globalThis', 'global'].includes(node.object.name) && browserDialogs.has(property)) add(node, node.object.name + '.' + property)
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
