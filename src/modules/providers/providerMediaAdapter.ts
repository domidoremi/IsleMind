import type { AIProvider } from '@/types/providerContracts'
import { ProviderHttpError } from './providerOperationResult'
import { safeProviderResponseText } from './providerTransportUtils'

export interface ProviderAudioTranscriptionInput {
  provider: AIProvider
  audioBase64: string
  mimeType: string
  fileName?: string
  model?: string
}

export interface ProviderSpeechInput {
  provider: AIProvider
  text: string
  model?: string
  voice?: string
}

export interface ProviderMediaAdapterDependencies {
  selectProvider(provider: AIProvider, model: string): AIProvider
  validateConfiguration(provider: AIProvider): string | undefined
  supportsAudio(provider: AIProvider): boolean
  request(input: RequestInfo | URL, init: RequestInit | undefined, timeoutMs: number): Promise<Response>
  timeoutMs: number
  resolveBaseUrl(provider: AIProvider): string
  resolveHeaders(provider: AIProvider): Record<string, string>
  transcribeGoogle?(input: ProviderAudioTranscriptionInput & { provider: AIProvider }): Promise<string>
}

export interface ProviderMediaAdapter {
  transcribe(input: ProviderAudioTranscriptionInput): Promise<string>
  synthesize(input: ProviderSpeechInput): Promise<string>
}

export function createProviderMediaAdapter(dependencies: ProviderMediaAdapterDependencies): ProviderMediaAdapter {
  return {
    async transcribe(input) {
      const model = input.model ?? 'whisper-1'
      const provider = dependencies.selectProvider(input.provider, model)
      assertConfigured(provider, dependencies)
      const declaresTranscription = provider.capabilities?.audioTranscription === true
        || (provider.type === 'google' && provider.capabilities?.audioInput === true)
      if (!declaresTranscription || !dependencies.supportsAudio(provider)) throw new Error('audio_transcription_unavailable')

      if (provider.type === 'google' && dependencies.transcribeGoogle) {
        return dependencies.transcribeGoogle({ ...input, provider })
      }
      if (provider.type !== 'openai' && provider.type !== 'openai-compatible') {
        throw new Error('audio_transcription_unavailable')
      }
      const form = new FormData()
      form.append('model', model)
      form.append('file', {
        uri: `data:${input.mimeType};base64,${input.audioBase64}`,
        name: input.fileName ?? 'audio.m4a',
        type: input.mimeType,
      } as unknown as Blob)
      const response = await dependencies.request(`${trimTrailingSlash(dependencies.resolveBaseUrl(provider))}/audio/transcriptions`, {
        method: 'POST',
        headers: omitContentTypeHeader(dependencies.resolveHeaders(provider)),
        body: form,
      }, dependencies.timeoutMs)
      if (!response.ok) throw new ProviderHttpError(response.status, await safeProviderResponseText(response))
      const json = await response.json() as { text?: unknown }
      return typeof json.text === 'string' ? json.text : ''
    },
    async synthesize(input) {
      const model = input.model ?? 'gpt-4o-mini-tts'
      const provider = dependencies.selectProvider(input.provider, model)
      assertConfigured(provider, dependencies)
      if (provider.capabilities?.speech !== true || !dependencies.supportsAudio(provider)) throw new Error('speech_unavailable')
      if (provider.type !== 'openai' && provider.type !== 'openai-compatible') throw new Error('speech_unavailable')
      const response = await dependencies.request(`${trimTrailingSlash(dependencies.resolveBaseUrl(provider))}/audio/speech`, {
        method: 'POST',
        headers: dependencies.resolveHeaders(provider),
        body: JSON.stringify({
          model,
          voice: input.voice ?? 'alloy',
          input: input.text.slice(0, 4000),
          response_format: 'mp3',
        }),
      }, dependencies.timeoutMs)
      if (!response.ok) throw new ProviderHttpError(response.status, await safeProviderResponseText(response))
      return arrayBufferToBase64(await response.arrayBuffer())
    },
  }
}

function omitContentTypeHeader(headers: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'content-type'))
}

function assertConfigured(provider: AIProvider, dependencies: ProviderMediaAdapterDependencies): void {
  if (!provider.apiKey.trim()) throw new Error('missing_key')
  const issue = dependencies.validateConfiguration(provider)
  if (issue) throw new Error(issue)
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]
    const second = bytes[index + 1]
    const third = bytes[index + 2]
    output += chars[first >> 2]
    output += chars[((first & 3) << 4) | ((second ?? 0) >> 4)]
    output += index + 1 < bytes.length ? chars[(((second ?? 0) & 15) << 2) | ((third ?? 0) >> 6)] : '='
    output += index + 2 < bytes.length ? chars[(third ?? 0) & 63] : '='
  }
  return output
}
