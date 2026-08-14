import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import { st } from '@/i18n/service'
import {
  createKnowledgeDocumentImporter,
  createKnowledgeDocumentImportUseCase,
  KnowledgeDocumentImportCancelledError,
} from '@/modules/knowledge'
import { generateProviderText } from '@/bootstrap/providerRuntime'
import { createKnowledgeDocumentIndex, knowledgeRepository } from '@/bootstrap/knowledgeRepository'
import { useSettingsStore } from '@/store/settingsStore'
import type { AIProvider } from '@/types/providerContracts'
import {
  MAX_IMPORT_TEXT_FILE_BYTES,
  assertImportFileSizeByUri,
  deleteTemporaryImportCopy,
  isFileTooLargeError,
  readUtf8ImportFile,
} from '@/platform/native/boundedImportFile'
import { logContextOperation } from '@/services/runtimeHealthLog'

const TEXT_MIME_HINTS = ['text/', 'application/json', 'application/javascript', 'application/xml', 'text/xml', 'text/csv']
const PICKER_MIME_TYPES = ['text/*', 'application/json', 'application/javascript', 'application/xml', 'text/xml', 'text/csv', 'application/pdf']

export interface KnowledgeDocumentImportOptions {
  signal: AbortSignal
}

export async function importKnowledgeFile(
  provider: AIProvider | undefined,
  model: string | undefined,
  options: KnowledgeDocumentImportOptions,
): Promise<{ ok: boolean; message: string }> {
  const { signal } = options
  let importUri: string | undefined
  let importTitle: string | undefined
  let sourceType: 'text' | 'pdf' | undefined
  try {
    throwIfAborted(signal)
    const picked = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      type: PICKER_MIME_TYPES,
    })
    if (!picked.canceled && picked.assets[0]) importUri = validatePickerAssetUri(picked.assets[0])
    throwIfAborted(signal)
    if (picked.canceled || !picked.assets[0]) return { ok: false, message: st('contextImport.noFileSelected') }

    const asset = validatePickerAsset(picked.assets[0])
    importTitle = asset.name
    await initializeKnowledgeRepository(signal)
    throwIfAborted(signal)

    const resolvedSize = (await assertImportFileSizeByUri(asset.uri, {
      ...(asset.size === undefined ? {} : { size: asset.size }),
      limitBytes: MAX_IMPORT_TEXT_FILE_BYTES,
    })) ?? asset.size ?? 0
    throwIfAborted(signal)

    if (isTextMime(asset.mimeType) || /\.(md|txt|json|csv|xml|js|ts|tsx|jsx)$/i.test(asset.name)) {
      sourceType = 'text'
      const text = await readUtf8ImportFile(asset.uri, {
        size: resolvedSize,
        limitBytes: MAX_IMPORT_TEXT_FILE_BYTES,
      })
      throwIfAborted(signal)
      await importKnowledgeDocumentThroughTarget(
        { title: asset.name, mimeType: asset.mimeType, size: resolvedSize, text, sourceUri: asset.name },
        provider,
        signal,
      )
      return { ok: true, message: st('contextImport.importedFile', { name: asset.name }) }
    }

    if (asset.mimeType === 'application/pdf' || asset.name.toLowerCase().endsWith('.pdf')) {
      sourceType = 'pdf'
      if (!provider?.apiKey || !model) return { ok: false, message: st('contextImport.pdfNeedsKey') }
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 })
      throwIfAborted(signal)
      const text = await generateProviderText({
        provider,
        model,
        systemPrompt: '请从用户提供的 PDF 中提取可检索的正文。只输出正文，不要总结，不要加解释。',
        messages: [{ role: 'user', content: '请提取这个 PDF 的正文，保留标题、小节和关键列表。' }],
        attachments: [{
          id: `${Date.now()}-pdf`,
          type: 'pdf',
          uri: asset.uri,
          name: asset.name,
          mimeType: asset.mimeType,
          size: resolvedSize,
          base64,
        }],
        temperature: 0.1,
        maxTokens: 12000,
        generationParameterSources: { temperature: 'internal-policy', maxTokens: 'internal-policy' },
        usageContext: { source: 'knowledge' },
        signal,
      })
      throwIfAborted(signal)
      if (!text.trim()) return { ok: false, message: st('contextImport.pdfExtractFailed') }
      await importKnowledgeDocumentThroughTarget(
        { title: asset.name, mimeType: asset.mimeType, size: resolvedSize, text, sourceUri: asset.name },
        provider,
        signal,
      )
      return { ok: true, message: st('contextImport.pdfImported', { name: asset.name }) }
    }

    return { ok: false, message: st('contextImport.unsupportedFileType') }
  } catch (error) {
    if (signal.aborted || isCancellationError(error)) throw createAbortError()
    if (isFileTooLargeError(error)) return { ok: false, message: st('chat.fileTooLarge20') }
    await logContextOperation({
      phase: 'knowledge_import',
      status: 'error',
      detail: 'import_knowledge_file_failed',
      sourceType,
      title: importTitle,
      providerId: provider?.id,
      model,
      error,
    }).catch(() => undefined)
    throw error
  } finally {
    await deleteTemporaryImportCopy(importUri, { assumeTemporaryCopy: true })
  }
}

export async function importKnowledgePlainText(
  title: string,
  text: string,
  provider: AIProvider | undefined,
  options: KnowledgeDocumentImportOptions,
): Promise<{ ok: boolean; message: string }> {
  const resolvedTitle = title.trim() || st('contextImport.pastedTextTitle', { time: new Date().toLocaleString() })
  try {
    throwIfAborted(options.signal)
    await initializeKnowledgeRepository(options.signal)
    throwIfAborted(options.signal)
    const content = text.trim()
    if (!content) return { ok: false, message: st('contextImport.emptyText') }
    await importKnowledgeDocumentThroughTarget(
      { title: resolvedTitle, mimeType: 'text/plain', size: content.length, text: content },
      provider,
      options.signal,
    )
    return { ok: true, message: st('contextImport.pastedTextImported') }
  } catch (error) {
    if (options.signal.aborted || isCancellationError(error)) throw createAbortError()
    await logContextOperation({
      phase: 'knowledge_import',
      status: 'error',
      detail: 'import_knowledge_plain_text_failed',
      sourceType: 'plain_text',
      title: resolvedTitle,
      providerId: provider?.id,
      error,
    }).catch(() => undefined)
    throw error
  }
}

async function initializeKnowledgeRepository(signal: AbortSignal): Promise<void> {
  await Promise.all([
    knowledgeRepository.listMemories({ signal }),
    knowledgeRepository.listDocuments({ signal }),
  ])
}

function importKnowledgeDocumentThroughTarget(
  input: { title: string; mimeType: string; size: number; text: string; sourceUri?: string },
  provider: AIProvider | undefined,
  signal: AbortSignal,
) {
  const settings = useSettingsStore.getState().settings
  return createKnowledgeDocumentImportUseCase({
    port: createKnowledgeDocumentImporter({
      repository: knowledgeRepository,
      index: createKnowledgeDocumentIndex({
        provider,
        embeddingMode: settings.embeddingMode ?? 'hybrid',
        localEmbeddingModelId: settings.localEmbeddingModelId,
        localEmbeddingModelSource: settings.localEmbeddingModelSource,
      }),
    }),
  }).import(input, { signal })
}

function validatePickerAsset(value: unknown): { uri: string; name: string; mimeType: string; size?: number } {
  if (!value || typeof value !== 'object') throw new Error('Invalid document picker asset.')
  const candidate = value as Record<string, unknown>
  const uri = validatePickerAssetUri(candidate)
  const name = validatePickerText(candidate.name, 'name', 512)
  if (name === '.' || name === '..' || /[\\/]/.test(name) || /^[a-z][a-z0-9+.-]*:/i.test(name)) {
    throw new Error('Invalid document picker asset name.')
  }
  const rawMimeType = candidate.mimeType
  const mimeType = rawMimeType == null ? 'application/octet-stream' : validatePickerText(rawMimeType, 'MIME type', 256).toLowerCase()
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(mimeType)) {
    throw new Error('Invalid document picker asset MIME type.')
  }
  const rawSize = candidate.size
  if (rawSize !== undefined && (!Number.isSafeInteger(rawSize) || (rawSize as number) < 0)) {
    throw new Error('Invalid document picker asset size.')
  }
  return { uri, name, mimeType, ...(rawSize === undefined ? {} : { size: rawSize as number }) }
}

function validatePickerAssetUri(value: unknown): string {
  if (!value || typeof value !== 'object') throw new Error('Invalid document picker asset.')
  const uri = validatePickerText((value as Record<string, unknown>).uri, 'URI', 2_048)
  if (!/^(?:file|content):\/\//i.test(uri)) throw new Error('Invalid document picker asset URI.')
  return uri
}

function validatePickerText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value !== value.trim() || !value || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`Invalid document picker asset ${label}.`)
  }
  return value
}

function isTextMime(mimeType: string): boolean {
  return TEXT_MIME_HINTS.some((hint) => mimeType.startsWith(hint) || mimeType === hint)
}

function isCancellationError(error: unknown): boolean {
  return error instanceof KnowledgeDocumentImportCancelledError
    || (error instanceof Error && error.name === 'AbortError')
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw createAbortError()
}

function createAbortError(): Error {
  const error = new Error('The knowledge document import was cancelled.')
  error.name = 'AbortError'
  return error
}
