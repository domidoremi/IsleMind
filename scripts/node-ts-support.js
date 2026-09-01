const babel = require('@babel/core')
const parser = require('@babel/parser')

// Transpiles a TypeScript/TSX module to CommonJS for execution under plain Node.
// Replaces the TypeScript compiler's transpileModule, which no longer exists in
// TypeScript 7 (the native build ships no JS compiler API).
//
// The TypeScript compiler's esModuleInterop namespace import builds a proxy with
// live getters onto the required module, so monkey-patching a module stub after
// the importing module has loaded stays visible. Babel's _interopRequireWildcard
// copies property values instead, which breaks that pattern, so the second pass
// swaps the helper body for a TypeScript-compatible live implementation.
function transformTypeScriptModule(source, filename) {
  const isTsx = filename.endsWith('.tsx')
  const transformed = babel.transformSync(source, {
    filename,
    babelrc: false,
    configFile: false,
    compact: false,
    sourceType: 'unambiguous',
    plugins: [
      [require.resolve('@babel/plugin-transform-typescript'), { isTSX: isTsx, allExtensions: true }],
      [require.resolve('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }],
      require.resolve('@babel/plugin-proposal-dynamic-import'),
      require.resolve('@babel/plugin-transform-modules-commonjs'),
    ],
  }).code
  return makeInteropBindingsLive(transformed, filename)
}

function makeInteropBindingsLive(code, filename) {
  return babel.transformSync(code, {
    filename: `${filename}.interop.js`,
    babelrc: false,
    configFile: false,
    compact: false,
    plugins: [liveInteropPlugin],
  }).code
}

const liveInteropPlugin = {
  visitor: {
    FunctionDeclaration(path) {
      if (path.node.id?.name !== '_interopRequireWildcard') return
      path.node.params = [babel.types.identifier('mod')]
      path.node.body = babel.types.blockStatement([
        babel.template.ast('if (mod && mod.__esModule) return mod'),
        babel.template.ast('var result = {}'),
        babel.template.ast(`
          if (mod != null) {
            for (let key of Object.getOwnPropertyNames(mod)) {
              if (key !== 'default') {
                Object.defineProperty(result, key, { enumerable: true, get: function () { return mod[key]; } });
              }
            }
          }
        `),
        babel.template.ast("Object.defineProperty(result, 'default', { enumerable: true, value: mod })"),
        babel.template.ast('return result'),
      ])
    },
  },
}

// Parses a TypeScript/TSX file into a Babel AST for source-level audits.
function parseTypeScriptModule(source, filename) {
  const isJsx = filename.endsWith('.tsx') || filename.endsWith('.jsx')
  return parser.parse(source, {
    sourceType: 'unambiguous',
    allowReturnOutsideFunction: true,
    plugins: isJsx ? ['typescript', 'jsx'] : ['typescript'],
  })
}

module.exports = { transformTypeScriptModule, parseTypeScriptModule }
