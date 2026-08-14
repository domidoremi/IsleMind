export async function readContentUriUtf8(uri: string): Promise<string> {
  const response = await fetch(uri)
  if (!response.ok) throw new Error('error.importReadFailed')
  const bytes = await response.arrayBuffer()
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}
