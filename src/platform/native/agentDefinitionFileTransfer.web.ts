import type { ExpoPortableDataTransferOptions, ExpoPortableDataTransferPort } from './expoPortableDataTransfer'

/** Browser-local files only; no fetch, upload, endpoint, credential or permission import. */
export function createAgentDefinitionFileTransfer(options: ExpoPortableDataTransferOptions): ExpoPortableDataTransferPort {
  return {
    async exportJsonFile(json) {
      const uri = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = uri
      link.download = `islemind-agent-${(options.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-')}.json`
      document.body.appendChild(link)
      try { link.click() } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(uri), 30_000) }
      return { uri }
    },
    selectJsonFile({ signal } = {}) {
      if (signal?.aborted) return Promise.resolve({ ok: false, reason: 'operation_cancelled' })
      return new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'; input.accept = '.json,application/json'; input.style.display = 'none'
        let settled = false
        const finish = (result: Awaited<ReturnType<ExpoPortableDataTransferPort['selectJsonFile']>>) => {
          if (settled) return
          settled = true; signal?.removeEventListener('abort', abort); input.remove(); resolve(result)
        }
        const abort = () => finish({ ok: false, reason: 'operation_cancelled' })
        input.addEventListener('cancel', () => finish({ ok: false, reason: 'selection_cancelled' }))
        input.addEventListener('change', async () => {
          const file = input.files?.[0]
          if (!file) return finish({ ok: false, reason: 'selection_cancelled' })
          if (file.size > options.maxImportBytes) return finish({ ok: false, reason: 'file_too_large' })
          try {
            const json = await file.text()
            if (new TextEncoder().encode(json).byteLength > options.maxImportBytes) return finish({ ok: false, reason: 'file_too_large' })
            finish({ ok: true, json })
          } catch { finish({ ok: false, reason: 'read_failed' }) }
        })
        signal?.addEventListener('abort', abort, { once: true })
        document.body.appendChild(input)
        try { input.click() } catch { finish({ ok: false, reason: 'picker_failed' }) }
      })
    },
  }
}
