const path = require('node:path')

const installed = Symbol.for('islemind.expo.web-isolation')

function installWebIsolationHeaders() {
  const cliRoot = path.dirname(require.resolve('@expo/cli/package.json'))
  const { ManifestMiddleware } = require(path.join(cliRoot, 'build/src/start/server/middleware/ManifestMiddleware.js'))
  const original = ManifestMiddleware.prototype.handleWebRequestAsync
  if (typeof original !== 'function') throw new Error('The Expo web document handler is unavailable')
  if (original[installed]) return

  // Expo prepends its SPA document handler ahead of Metro's middleware. The
  // root HTML must carry the same headers as deep links and SQLite workers.
  const handleWebRequestAsync = async function (request, response) {
    response.setHeader('Cross-Origin-Embedder-Policy', 'credentialless')
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    return original.call(this, request, response)
  }
  Object.defineProperty(handleWebRequestAsync, installed, { value: true })
  ManifestMiddleware.prototype.handleWebRequestAsync = handleWebRequestAsync
}

module.exports = { installWebIsolationHeaders }
