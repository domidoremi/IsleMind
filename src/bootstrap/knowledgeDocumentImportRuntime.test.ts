import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import { importKnowledgeFile } from './knowledgeDocumentImportRuntime'

const mockImport = jest.fn(async (..._args: unknown[]) => undefined)
jest.mock('react-native', () => ({ Platform: { OS: 'web' } }))
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }))
jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: jest.fn(), getInfoAsync: jest.fn(), deleteAsync: jest.fn(async () => undefined), EncodingType: { UTF8: 'utf8' },
}))
jest.mock('@/i18n/service', () => ({ st: (key: string) => key }))
jest.mock('@/modules/knowledge', () => ({
  createKnowledgeDocumentImporter: jest.fn(),
  createKnowledgeDocumentImportUseCase: () => ({ import: (...args: unknown[]) => mockImport(...args) }),
  KnowledgeDocumentImportCancelledError: class extends Error {},
}))
jest.mock('@/bootstrap/providerRuntime', () => ({ generateProviderText: jest.fn() }))
jest.mock('@/bootstrap/knowledgeRepository', () => ({
  createKnowledgeDocumentIndex: jest.fn(),
  knowledgeRepository: { listMemories: async () => [], listDocuments: async () => [] },
}))
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: { getState: () => ({ settings: { embeddingMode: 'local' } }) } }))
jest.mock('@/services/runtimeHealthLog', () => ({ logContextOperation: async () => undefined }))

const blobDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Blob')
beforeAll(() => Object.defineProperty(globalThis, 'Blob', { configurable: true, value: require('node:buffer').Blob }))
afterAll(() => {
  if (blobDescriptor) Object.defineProperty(globalThis, 'Blob', blobDescriptor)
  else Reflect.deleteProperty(globalThis, 'Blob')
})
beforeEach(() => jest.clearAllMocks())

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

it.each(['https://fixture.invalid/qa.txt', 'blob:http://127.0.0.1:8097/unselected'])('still rejects an unselected or remote URI: %s', async uri => {
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({ canceled: false, assets: [{ name: 'qa.txt', uri, size: 1 }] } as never)
  await expect(importKnowledgeFile(undefined, undefined, { signal: new AbortController().signal })).rejects.toThrow('Invalid document picker asset URI')
  expect(mockImport).not.toHaveBeenCalled()
  expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled()
})
