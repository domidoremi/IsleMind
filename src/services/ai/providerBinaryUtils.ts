export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]
    const b = bytes[index + 1]
    const c = bytes[index + 2]
    output += chars[a >> 2]
    output += chars[((a & 3) << 4) | ((b ?? 0) >> 4)]
    output += index + 1 < bytes.length ? chars[((b & 15) << 2) | ((c ?? 0) >> 6)] : '='
    output += index + 2 < bytes.length ? chars[(c ?? 0) & 63] : '='
  }
  return output
}
