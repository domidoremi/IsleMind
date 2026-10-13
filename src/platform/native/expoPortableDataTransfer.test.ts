import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import { createExpoPortableDataTransferPort } from './expoPortableDataTransfer'

jest.mock('react-native', () => ({ Platform: { OS: 'web' } }))
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }))
jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: jest.fn(), writeAsStringAsync: jest.fn(), deleteAsync: jest.fn(async () => undefined), EncodingType: { UTF8: 'utf8' },
}))
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn() }))
jest.mock('./androidDownloadsPublisher', () => ({ publishPortableJsonFileToDownloads: jest.fn() }))

const port = createExpoPortableDataTransferPort({ maxImportBytes: 64, exportDialogTitle: () => 'Export', now: () => new Date('2026-10-08T00:00:00Z') })
beforeEach(() => jest.clearAllMocks())

it('reads a browser-selected File without sending its data URL to the native filesystem', async () => {
  const file = { size: 13, text: jest.fn(async () => '{"version":1}') }
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({ canceled: false, assets: [{ name: 'qa.json', uri: 'data:application/json;base64,e30=', size: file.size, file }] } as never)
  await expect(port.selectJsonFile()).resolves.toEqual({ ok: true, json: '{"version":1}' })
  expect(file.text).toHaveBeenCalledTimes(1)
  expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled()
})

it('enforces actual UTF-8 size even when picker metadata understates a browser file', async () => {
  const file = { size: 1, text: jest.fn(async () => '中'.repeat(30)) }
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({ canceled: false, assets: [{ name: 'qa.json', uri: 'data:application/json;base64,e30=', size: 1, file }] } as never)
  await expect(port.selectJsonFile()).resolves.toEqual({ ok: false, reason: 'file_too_large' })
  expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled()
})

it('exports through a browser download and releases its temporary blob URL', async () => {
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const createDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  const revokeDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
  const link = { href: '', download: '', click: jest.fn(), remove: jest.fn() }
  const appendChild = jest.fn()
  const createObjectURL = jest.fn(() => 'blob:qa-export')
  const revokeObjectURL = jest.fn()
  jest.useFakeTimers()
  try {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => link, body: { appendChild } } })
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    await expect(port.exportJsonFile('{"version":1}')).resolves.toEqual({ uri: 'blob:qa-export' })
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(link.download).toBe('islemind-export-2026-10-08T00-00-00-000Z.json')
    expect(appendChild).toHaveBeenCalledWith(link)
    expect(link.click).toHaveBeenCalledTimes(1)
    expect(link.remove).toHaveBeenCalledTimes(1)
    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled()
    jest.advanceTimersByTime(30_000)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:qa-export')
  } finally {
    jest.useRealTimers()
    for (const [target, key, descriptor] of [[globalThis, 'document', documentDescriptor], [URL, 'createObjectURL', createDescriptor], [URL, 'revokeObjectURL', revokeDescriptor]] as const) {
      if (descriptor) Object.defineProperty(target, key, descriptor)
      else Reflect.deleteProperty(target, key)
    }
  }
})
