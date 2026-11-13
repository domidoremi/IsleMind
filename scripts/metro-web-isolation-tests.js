const assert = require('node:assert/strict')
const http = require('node:http')
const path = require('node:path')
const { once } = require('node:events')
const { test } = require('node:test')
const { installWebIsolationHeaders } = require('./metro-web-isolation.cjs')

test('Expo root HTML and Metro deep links both enable the SQLite worker', async () => {
  const cliRoot = path.dirname(require.resolve('@expo/cli/package.json'))
  const { ManifestMiddleware } = require(path.join(cliRoot, 'build/src/start/server/middleware/ManifestMiddleware.js'))
  const nativeManifestHandler = ManifestMiddleware.prototype.handleRequestAsync
  installWebIsolationHeaders()
  const firstHandler = ManifestMiddleware.prototype.handleWebRequestAsync
  installWebIsolationHeaders()
  assert.equal(ManifestMiddleware.prototype.handleWebRequestAsync, firstHandler)
  assert.equal(ManifestMiddleware.prototype.handleRequestAsync, nativeManifestHandler)

  const document = '<!doctype html><title>IsleMind</title><main>Existing conversation</main>'
  const manifest = { getSingleHtmlTemplateAsync: async () => document }
  const server = http.createServer((request, response) => {
    if (request.url === '/') {
      // Exercise the real Expo HTML handler before any Metro middleware runs.
      void ManifestMiddleware.prototype.handleWebRequestAsync.call(manifest, request, response)
        .catch(error => { response.statusCode = 500; response.end(String(error)) })
      return
    }
    response.setHeader('Cross-Origin-Embedder-Policy', 'credentialless')
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    response.setHeader('Content-Type', 'text/html')
    response.end(document)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const origin = `http://127.0.0.1:${server.address().port}`
    for (const route of ['/', '/chat/existing-conversation']) {
      const response = await fetch(origin + route)
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('cross-origin-embedder-policy'), 'credentialless')
      assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin')
      assert.equal(response.headers.get('content-type'), 'text/html')
      assert.equal(await response.text(), document)
    }
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})
