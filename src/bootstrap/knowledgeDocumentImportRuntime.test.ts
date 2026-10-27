import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import { importKnowledgeFile, importKnowledgePlainText } from './knowledgeDocumentImportRuntime'
import type { Settings } from '@/types/settingsContracts'
import type { AIProvider } from '@/types/providerContracts'

const mockImport = jest.fn(async (..._args: unknown[]): Promise<unknown> => undefined)
const mockObserveUpgrade = jest.fn()
const mockCreateIndex = jest.fn()
const mockInitialize = jest.fn(async () => [])
let mockSettings = { embeddingMode: 'local', localEmbeddingModelId: 'reviewed-local' } as Settings
jest.mock('react-native', () => ({ Platform: { OS: 'web' } }))
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }))
jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: jest.fn(), getInfoAsync: jest.fn(), deleteAsync: jest.fn(async () => undefined), EncodingType: { UTF8: 'utf8' },
}))
jest.mock('@/i18n/service', () => ({ st: (key: string) => key }))
jest.mock('@/modules/knowledge', () => ({
  createKnowledgeDocumentImporter: () => ({ import: (...args: unknown[]) => mockImport(...args) }),
  ...jest.requireActual('@/modules/knowledge/application/knowledgeDocumentImport'),
}))
jest.mock('@/bootstrap/providerRuntime', () => ({ generateProviderText: jest.fn() }))
jest.mock('@/bootstrap/knowledgeRepository', () => ({
  createKnowledgeDocumentIndex: (_indexing: unknown, observe?: (task: Promise<void>) => void) => {
    mockCreateIndex(_indexing)
    mockObserveUpgrade(observe)
    return {}
  },
  knowledgeRepository: { listMemories: () => mockInitialize(), listDocuments: async () => [] },
}))
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: { getState: () => ({ settings: mockSettings }) } }))
jest.mock('@/modules/providers', () => ({
  ...jest.requireActual('@/modules/providers/providerConfigurationMutation'),
  ProviderContextCapacityError: jest.requireActual('@/modules/providers/providerContextCapacity').ProviderContextCapacityError,
}))
jest.mock('@/services/runtimeHealthLog', () => ({ logContextOperation: async () => undefined }))

const blobDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Blob')
beforeAll(() => Object.defineProperty(globalThis, 'Blob', { configurable: true, value: require('node:buffer').Blob }))
afterAll(() => {
  if (blobDescriptor) Object.defineProperty(globalThis, 'Blob', blobDescriptor)
  else Reflect.deleteProperty(globalThis, 'Blob')
})
beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(DocumentPicker.getDocumentAsync).mockReset()
  jest.mocked(FileSystem.deleteAsync).mockReset().mockResolvedValue(undefined)
  jest.mocked(FileSystem.readAsStringAsync).mockReset()
  mockImport.mockReset().mockImplementation(async (input: any) => ({ documentId: 'owned-document', title: input.title, chunkCount: 1 }))
  mockInitialize.mockReset().mockResolvedValue([])
  mockSettings = { embeddingMode: 'local', localEmbeddingModelId: 'reviewed-local' } as Settings
})

it.each(['explicit', 'current'] as const)('retains the %s indexing settings before awaited repository admission', async mode => {
  let admit!: () => void
  mockInitialize.mockImplementationOnce(() => new Promise<[]>(resolve => { admit = () => resolve([]) }))
  const reviewed = { ...mockSettings, localEmbeddingModelId: 'operation-local' }
  const options = { signal: new AbortController().signal, ...(mode === 'explicit' ? { settings: reviewed } : {}) }
  const pending = importKnowledgePlainText('Reviewed title', 'Reviewed text', undefined, options)
  mockSettings.embeddingMode = 'provider'; mockSettings.localEmbeddingModelId = 'changed-live'
  reviewed.embeddingMode = 'provider'; reviewed.localEmbeddingModelId = 'changed-caller'
  admit()
  await pending
  expect(mockCreateIndex).toHaveBeenCalledWith(expect.objectContaining({
    embeddingMode: 'local', localEmbeddingModelId: mode === 'explicit' ? 'operation-local' : 'reviewed-local',
  }))
})

it('detaches provider and indexing configuration before the file picker resolves', async () => {
  let select!: (value: unknown) => void
  jest.mocked(DocumentPicker.getDocumentAsync).mockImplementationOnce(() => new Promise(resolve => { select = resolve as never }))
  const provider = { id: 'reviewed', apiKey: 'synthetic-old-key', baseUrl: 'https://old.invalid/v1' } as AIProvider
  const pending = importKnowledgeFile(provider, undefined, { signal: new AbortController().signal })
  provider.baseUrl = 'https://changed.invalid/v1'; provider.apiKey = 'synthetic-new-key'
  mockSettings.localEmbeddingModelId = 'changed-live'
  const file = new Blob(['Reviewed text'], { type: 'text/plain' })
  select({ canceled: false, assets: [{ name: 'qa.txt', uri: 'blob:http://127.0.0.1:8097/owned', mimeType: 'text/plain', file }] })
  await pending
  expect(mockCreateIndex).toHaveBeenCalledWith(expect.objectContaining({
    provider: expect.objectContaining({ apiKey: 'synthetic-old-key', baseUrl: 'https://old.invalid/v1' }),
    localEmbeddingModelId: 'reviewed-local',
  }))
})

it('retains the originally admitted signal when a plain-text caller replaces its options while admission waits', async () => {
  let admit!: () => void
  mockInitialize.mockImplementationOnce(() => new Promise<[]>(resolve => { admit = () => resolve([]) }))
  const controller = new AbortController(), options = { signal: controller.signal }
  const pending = importKnowledgePlainText('Reviewed title', 'Reviewed text', undefined, options)
  const check = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  options.signal = new AbortController().signal; controller.abort()
  admit()
  await check
  expect(mockImport).not.toHaveBeenCalled()
})

it('holds diagnostic import acknowledgement through the provider-upgrade settlement it owns', async () => {
  let finish!: () => void
  const upgrade = new Promise<void>(resolve => { finish = resolve })
  mockImport.mockImplementationOnce(async () => {
    mockObserveUpgrade.mock.calls[0][0](upgrade)
    return { documentId: 'owned-document', title: 'Reviewed title', chunkCount: 1 }
  })
  let settled = false
  const pending = importKnowledgePlainText('Reviewed title', 'Reviewed text', undefined, {
    signal: new AbortController().signal, waitForProviderUpgrades: true,
  }).then(() => { settled = true })
  for (let step = 0; step < 20; step++) await Promise.resolve()
  expect(mockImport).toHaveBeenCalledTimes(1)
  expect(settled).toBe(false)
  finish()
  await pending
})

it('preserves ordinary background provider-upgrade acknowledgement when diagnostic settlement was not requested', async () => {
  let finish!: () => void
  const upgrade = new Promise<void>(resolve => { finish = resolve })
  mockImport.mockImplementationOnce(async () => {
    mockObserveUpgrade.mock.calls[0][0](upgrade)
    return { documentId: 'owned-document', title: 'Reviewed title', chunkCount: 1 }
  })
  await importKnowledgePlainText('Reviewed title', 'Reviewed text', undefined, { signal: new AbortController().signal })
  finish()
})

it('does not return diagnostic import success if cancelled while its admitted upgrade is settling', async () => {
  let finish!: () => void, entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const upgrade = new Promise<void>(resolve => { finish = resolve })
  mockImport.mockImplementationOnce(async () => {
    mockObserveUpgrade.mock.calls[0][0](upgrade)
    entered()
    return { documentId: 'owned-document', title: 'Reviewed title', chunkCount: 1 }
  })
  const controller = new AbortController()
  let settled = false
  const pending = importKnowledgePlainText('Reviewed title', 'Reviewed text', undefined, {
    signal: controller.signal, waitForProviderUpgrades: true,
  }).then(value => { settled = true; return value }, error => { settled = true; throw error })
  const check = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  await started
  controller.abort()
  await Promise.resolve()
  expect(settled).toBe(false)
  finish()
  await check
})

it('passes captured request settings and provider to PDF extraction after a delayed picker', async () => {
  const { generateProviderText } = jest.requireMock('@/bootstrap/providerRuntime')
  let select!: (value: unknown) => void
  jest.mocked(DocumentPicker.getDocumentAsync).mockImplementationOnce(() => new Promise(resolve => { select = resolve as never }))
  jest.mocked(FileSystem.readAsStringAsync).mockResolvedValueOnce('synthetic-base64')
  generateProviderText.mockResolvedValueOnce('Reviewed extracted text')
  const provider = { id: 'reviewed', apiKey: 'synthetic-old-key' } as AIProvider
  const settings: Settings = { ...mockSettings, proxyMode: 'off' }
  const pending = importKnowledgeFile(provider, 'reviewed-model', { signal: new AbortController().signal, settings })
  provider.apiKey = 'synthetic-changed-key'; settings.proxyMode = 'custom-base-url'
  select({ canceled: false, assets: [{ name: 'qa.pdf', uri: 'file:///owned-cache/qa.pdf', mimeType: 'application/pdf', size: 10 }] })
  await pending
  expect(generateProviderText).toHaveBeenCalledWith(expect.objectContaining({
    provider: expect.objectContaining({ apiKey: 'synthetic-old-key' }), settings: expect.objectContaining({ proxyMode: 'off' }),
    model: 'reviewed-model', maxTokens: 12000,
  }))
})

it('imports the selected browser text locally, using actual File bytes rather than native blob-URI reads', async () => {
  const text = '本机知识: synthetic local text.'
  const file = new Blob([text], { type: 'text/plain' })
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({ canceled: false, assets: [{
    name: 'qa.txt', uri: 'blob:http://127.0.0.1:8097/local-fixture', mimeType: 'text/plain', size: 1, file,
  }] } as never)
  const signal = new AbortController().signal
  await expect(importKnowledgeFile(undefined, undefined, { signal })).resolves.toEqual({ ok: true, message: 'contextImport.importedFile' })
  expect(mockImport).toHaveBeenCalledWith({ title: 'qa.txt', mimeType: 'text/plain', size: file.size, text, sourceUri: 'qa.txt' }, { signal })
  expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled()
})

it.each(['file', 'text'] as const)('keeps the cancelled %s application import pending until its owned target port settles', async kind => {
  const controller = new AbortController()
  let finish!: (value: unknown) => void
  mockImport.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  if (kind === 'file') {
    const file = new Blob(['Owned local text'], { type: 'text/plain' })
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({ canceled: false, assets: [{
      name: 'qa.txt', uri: 'blob:http://127.0.0.1:8097/owned-fixture', mimeType: 'text/plain', file,
    }] } as never)
  }
  let settled = false
  const outcome = (kind === 'file' ? importKnowledgeFile(undefined, undefined, { signal: controller.signal })
    : importKnowledgePlainText('qa.txt', 'Owned local text', undefined, { signal: controller.signal }))
    .then(value => { settled = true; return value }, error => { settled = true; throw error })
  const rejection = expect(outcome).rejects.toMatchObject({ name: 'AbortError' })
  for (let step = 0; step < 100 && !mockImport.mock.calls.length; step++) {
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  expect(mockImport).toHaveBeenCalledTimes(1)
  expect(mockImport.mock.calls[0][1]).toEqual({ signal: controller.signal })
  controller.abort()
  for (let step = 0; step < 10; step++) await Promise.resolve()
  expect(settled).toBe(false)
  finish({ documentId: 'owned-document', title: 'qa.txt', chunkCount: 1 })
  await rejection
  expect(settled).toBe(true)
})

it.each(['https://fixture.invalid/qa.txt', 'blob:http://127.0.0.1:8097/unselected'])('still rejects an unselected or remote URI: %s', async uri => {
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({ canceled: false, assets: [{ name: 'qa.txt', uri, size: 1 }] } as never)
  await expect(importKnowledgeFile(undefined, undefined, { signal: new AbortController().signal })).rejects.toThrow('Invalid document picker asset URI')
  expect(mockImport).not.toHaveBeenCalled()
  expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled()
})

it('waits for a tracked provider upgrade after cancelling its canonical import port', async () => {
  let finishPort!: (value: unknown) => void
  let finishUpgrade!: () => void
  const upgrade = new Promise<void>(resolve => { finishUpgrade = resolve })
  mockImport.mockImplementationOnce(() => {
    mockObserveUpgrade.mock.calls[0][0]?.(upgrade)
    return new Promise(resolve => { finishPort = resolve })
  })
  const controller = new AbortController()
  let settled = false
  const outcome = importKnowledgePlainText('Owned title', 'Owned text', undefined, { signal: controller.signal })
    .then(value => { settled = true; return value }, error => { settled = true; throw error })
  const rejection = expect(outcome).rejects.toMatchObject({ name: 'AbortError' })
  for (let step = 0; step < 100 && !mockImport.mock.calls.length; step++) {
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  expect(mockImport).toHaveBeenCalledTimes(1)
  controller.abort()
  finishPort({ documentId: 'owned-document', title: 'Owned title', chunkCount: 1 })
  for (let step = 0; step < 15; step++) await Promise.resolve()
  expect(settled).toBe(false)
  expect(mockObserveUpgrade.mock.calls[0][0]).toEqual(expect.any(Function))
  finishUpgrade()
  await rejection
})

it('waits for a rejected cancelled target and rejects as cancellation rather than late success', async () => {
  let fail!: (error: Error) => void
  mockImport.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
  const controller = new AbortController()
  let settled = false
  const outcome = importKnowledgePlainText('Owned title', 'Owned text', undefined, { signal: controller.signal })
    .then(value => { settled = true; return value }, error => { settled = true; throw error })
  const rejection = expect(outcome).rejects.toMatchObject({ name: 'AbortError' })
  for (let step = 0; step < 100 && !mockImport.mock.calls.length; step++) {
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  expect(mockImport).toHaveBeenCalledTimes(1)
  controller.abort()
  for (let step = 0; step < 10; step++) await Promise.resolve()
  expect(settled).toBe(false)
  fail(new Error('Target cleanup finished with failure'))
  await rejection
})

it('waits for a late picker result and owned temporary-copy cleanup without dispatching an import after cancellation', async () => {
  let select!: (asset: unknown) => void
  jest.mocked(DocumentPicker.getDocumentAsync).mockImplementationOnce(() => new Promise(resolve => { select = resolve as never }))
  let cleanup!: () => void
  jest.mocked(FileSystem.deleteAsync).mockImplementationOnce(() => new Promise<void>(resolve => { cleanup = resolve }))
  const controller = new AbortController()
  let settled = false
  const outcome = importKnowledgeFile(undefined, undefined, { signal: controller.signal })
    .then(value => { settled = true; return value }, error => { settled = true; throw error })
  const rejection = expect(outcome).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort()
  await Promise.resolve()
  expect(settled).toBe(false)
  select({ canceled: false, assets: [{ name: 'qa.txt', uri: 'file:///owned-cache/qa.txt', mimeType: 'text/plain', size: 10 }] })
  for (let step = 0; step < 10; step++) await Promise.resolve()
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file:///owned-cache/qa.txt', { idempotent: true })
  expect(settled).toBe(false)
  expect(mockImport).not.toHaveBeenCalled()
  expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled()
  cleanup()
  await rejection
})

it('does not release cancelled partial-import readback before the actual importer records its recoverable status', async () => {
  const { createKnowledgeDocumentImporter } = jest.requireActual('@/modules/knowledge/application/knowledgeDocumentImporter')
  const documents: any[] = []
  let finishIndex!: () => void
  let finishStatus!: () => void
  const save = jest.fn(async (document: unknown) => { documents.push(document) })
  const update = jest.fn(() => new Promise<void>(resolve => {
    finishStatus = () => { documents[0] = { ...documents[0], status: 'error' }; resolve() }
  }))
  const actual = createKnowledgeDocumentImporter({
    repository: { saveDocument: save, updateDocumentStatus: update },
    index: { synchronize: () => new Promise<void>(resolve => { finishIndex = resolve }) },
    clock: { now: () => 1 }, ids: { next: (prefix: string) => `${prefix}-owned` },
  })
  mockImport.mockImplementationOnce((input, options) => actual.import(input, options))
  const controller = new AbortController()
  let settled = false
  const outcome = importKnowledgePlainText('Owned title', 'Owned text', undefined, { signal: controller.signal })
    .then(value => { settled = true; return value }, error => { settled = true; throw error })
  const rejection = expect(outcome).rejects.toMatchObject({ name: 'AbortError' })
  for (let step = 0; step < 100 && !documents.length; step++) {
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  expect(documents).toHaveLength(1)
  expect(documents[0].status).toBe('extracting')
  controller.abort()
  finishIndex()
  for (let step = 0; step < 15; step++) await Promise.resolve()
  expect(update).toHaveBeenCalledWith('knowledge-document-owned', 'error', expect.any(String))
  expect(settled).toBe(false)
  finishStatus()
  await rejection
  expect(documents).toHaveLength(1)
  expect(documents[0].status).toBe('error')
})

it('extracts a browser PDF from its actual binary File bytes without a native blob-URI read', async () => {
  const { generateProviderText } = jest.requireMock('@/bootstrap/providerRuntime')
  generateProviderText.mockReset().mockResolvedValueOnce('Owned extracted PDF body')
  const bytes = Uint8Array.from({ length: 68003 }, (_, index) => index % 256)
  const file = new Blob([bytes], { type: 'application/pdf' })
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({ canceled: false, assets: [{
    name: 'owned.pdf', uri: 'blob:http://127.0.0.1:8097/owned-pdf', mimeType: 'application/pdf', size: 1, file,
  }] } as never)
  jest.mocked(FileSystem.readAsStringAsync).mockRejectedValueOnce(new Error('Legacy Web read is unavailable'))
  const provider = { id: 'owned', apiKey: 'owned-inert-key' } as AIProvider
  const signal = new AbortController().signal
  await expect(importKnowledgeFile(provider, 'owned-model', { signal })).resolves.toEqual({
    ok: true, message: 'contextImport.pdfImported',
  })
  expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled()
  expect(generateProviderText).toHaveBeenCalledWith(expect.objectContaining({
    signal, model: 'owned-model',
    attachments: [expect.objectContaining({
      name: 'owned.pdf', size: file.size, base64: Buffer.from(bytes).toString('base64'),
    })],
  }))
  expect(mockImport).toHaveBeenCalledWith(expect.objectContaining({
    title: 'owned.pdf', text: 'Owned extracted PDF body', size: file.size, sourceUri: 'owned.pdf',
  }), { signal })
})

it('waits for an admitted browser PDF read to settle before completing cancellation and never dispatches afterward', async () => {
  const { generateProviderText } = jest.requireMock('@/bootstrap/providerRuntime')
  generateProviderText.mockReset()
  const file = new Blob(['Owned pending PDF bytes'], { type: 'application/pdf' })
  let finish!: (value: ArrayBuffer) => void
  const read = jest.fn(() => new Promise<ArrayBuffer>(resolve => { finish = resolve }))
  Object.defineProperty(file, 'arrayBuffer', { value: read })
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({ canceled: false, assets: [{
    name: 'owned-pending.pdf', uri: 'blob:http://127.0.0.1:8097/owned-pending-pdf', mimeType: 'application/pdf', file,
  }] } as never)
  jest.mocked(FileSystem.readAsStringAsync).mockRejectedValueOnce(new Error('Legacy Web read is unavailable'))
  const controller = new AbortController()
  let settled = false
  const pending = importKnowledgeFile({ id: 'owned', apiKey: 'owned-inert-key' } as AIProvider,
    'owned-model', { signal: controller.signal }).finally(() => { settled = true })
  pending.catch(() => undefined)
  for (let step = 0; step < 20; step++) await Promise.resolve()
  expect(read).toHaveBeenCalledTimes(1)
  controller.abort()
  for (let step = 0; step < 5; step++) await Promise.resolve()
  expect(settled).toBe(false)
  finish(new Uint8Array([37, 80, 68, 70]).buffer)
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(generateProviderText).not.toHaveBeenCalled()
  expect(mockImport).not.toHaveBeenCalled()
  expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled()
})

it('bounds the actual browser PDF read result even if an adapter reports a smaller File size', async () => {
  const { generateProviderText } = jest.requireMock('@/bootstrap/providerRuntime')
  generateProviderText.mockReset()
  const file = new Blob(['x'], { type: 'application/pdf' })
  Object.defineProperty(file, 'arrayBuffer', {
    value: jest.fn(async () => new ArrayBuffer(20 * 1024 * 1024 + 1)),
  })
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({ canceled: false, assets: [{
    name: 'owned-oversized.pdf', uri: 'blob:http://127.0.0.1:8097/owned-oversized-pdf',
    mimeType: 'application/pdf', size: 1, file,
  }] } as never)
  jest.mocked(FileSystem.readAsStringAsync).mockRejectedValueOnce(new Error('Legacy Web read is unavailable'))
  await expect(importKnowledgeFile({ id: 'owned', apiKey: 'owned-inert-key' } as AIProvider,
    'owned-model', { signal: new AbortController().signal })).resolves.toEqual({
    ok: false, message: 'chat.fileTooLarge20',
  })
  expect(generateProviderText).not.toHaveBeenCalled()
  expect(mockImport).not.toHaveBeenCalled()
  expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled()
})

it('continues to refuse an uncredentialed browser PDF before reading bytes or acquiring provider effects', async () => {
  const { generateProviderText } = jest.requireMock('@/bootstrap/providerRuntime')
  generateProviderText.mockReset()
  const file = new Blob(['Owned uncredentialed PDF bytes'], { type: 'application/pdf' })
  const read = jest.fn(async () => new ArrayBuffer(0))
  Object.defineProperty(file, 'arrayBuffer', { value: read })
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({ canceled: false, assets: [{
    name: 'owned-no-key.pdf', uri: 'blob:http://127.0.0.1:8097/owned-no-key-pdf', mimeType: 'application/pdf', file,
  }] } as never)
  await expect(importKnowledgeFile(undefined, undefined, { signal: new AbortController().signal }))
    .resolves.toEqual({ ok: false, message: 'contextImport.pdfNeedsKey' })
  expect(read).not.toHaveBeenCalled()
  expect(generateProviderText).not.toHaveBeenCalled()
  expect(mockImport).not.toHaveBeenCalled()
  expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled()
})

function selectOwnedPdf() {
  const file = new Blob([new Uint8Array([37, 80, 68, 70, 0, 255])], { type: 'application/pdf' })
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({ canceled: false, assets: [{
    name: 'owned-capacity.pdf', uri: 'blob:http://127.0.0.1:8097/owned-capacity',
    mimeType: 'application/pdf', file,
  }] } as never)
}

it('explains unmeasured PDF extraction refusal without indexing and permits an explicit later import', async () => {
  const { generateProviderText } = jest.requireMock('@/bootstrap/providerRuntime')
  const { ProviderContextCapacityError } = jest.requireActual('@/modules/providers/providerContextCapacity')
  generateProviderText.mockReset().mockRejectedValueOnce(new ProviderContextCapacityError('media_estimate_unavailable'))
  const provider = { id: 'owned', apiKey: 'owned-inert-key' } as AIProvider
  const options = { signal: new AbortController().signal }
  selectOwnedPdf()
  await expect(importKnowledgeFile(provider, 'owned-model', options)).resolves.toEqual({
    ok: false, message: 'contextImport.pdfCapacityUnavailable', reason: 'pdf_capacity_unavailable',
  })
  expect(mockImport).not.toHaveBeenCalled()
  expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled()
  expect(generateProviderText).toHaveBeenCalledTimes(1)
  generateProviderText.mockResolvedValueOnce('Owned extract from a subsequently admitted request')
  selectOwnedPdf()
  await expect(importKnowledgeFile(provider, 'owned-model', options)).resolves.toEqual({
    ok: true, message: 'contextImport.pdfImported',
  })
  expect(mockImport).toHaveBeenCalledTimes(1)
  expect(generateProviderText).toHaveBeenCalledTimes(2)
})

it.each(['context_capacity', 'invalid_capacity', 'request_too_large', 'untyped_media_error'] as const)(
  'does not misclassify %s extraction failure as the unmeasured-PDF refusal', async code => {
    const { generateProviderText } = jest.requireMock('@/bootstrap/providerRuntime')
    const { ProviderContextCapacityError } = jest.requireActual('@/modules/providers/providerContextCapacity')
    const error = code === 'untyped_media_error'
      ? new Error('media_estimate_unavailable')
      : new ProviderContextCapacityError(code)
    generateProviderText.mockReset().mockRejectedValueOnce(error)
    selectOwnedPdf()
    await expect(importKnowledgeFile({ id: 'owned', apiKey: 'owned-inert-key' } as AIProvider,
      'owned-model', { signal: new AbortController().signal })).rejects.toBe(error)
    expect(mockImport).not.toHaveBeenCalled()
  },
)

it('does not report a later indexing failure as a PDF refusal or claim nothing was written', async () => {
  const { generateProviderText } = jest.requireMock('@/bootstrap/providerRuntime')
  const { ProviderContextCapacityError } = jest.requireActual('@/modules/providers/providerContextCapacity')
  const error = new ProviderContextCapacityError('media_estimate_unavailable')
  generateProviderText.mockReset().mockResolvedValueOnce('Owned extracted body')
  mockImport.mockRejectedValueOnce(error)
  selectOwnedPdf()
  await expect(importKnowledgeFile({ id: 'owned', apiKey: 'owned-inert-key' } as AIProvider,
    'owned-model', { signal: new AbortController().signal })).rejects.toBe(error)
  expect(mockImport).toHaveBeenCalledTimes(1)
})

it('settles a cancelled PDF extraction as cancellation rather than late local-refusal feedback', async () => {
  const { generateProviderText } = jest.requireMock('@/bootstrap/providerRuntime')
  const { ProviderContextCapacityError } = jest.requireActual('@/modules/providers/providerContextCapacity')
  let reject!: (error: Error) => void
  generateProviderText.mockReset().mockImplementationOnce(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise }))
  selectOwnedPdf()
  const controller = new AbortController()
  const pending = importKnowledgeFile({ id: 'owned', apiKey: 'owned-inert-key' } as AIProvider,
    'owned-model', { signal: controller.signal })
  pending.catch(() => undefined)
  for (let step = 0; step < 20; step++) await Promise.resolve()
  expect(generateProviderText).toHaveBeenCalledTimes(1)
  controller.abort()
  reject(new ProviderContextCapacityError('media_estimate_unavailable'))
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(mockImport).not.toHaveBeenCalled()
})
