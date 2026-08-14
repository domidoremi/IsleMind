export function isUnsafeRuntimePairingText(input: string): boolean {
  return (
    /(?:^|[/?&\s])(api[-_]?key|token|secret|password|authorization|credential)(?:\s*[:=]|[/?&=]|$)/i.test(input) ||
    /(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{8,}/i.test(input) ||
    /(?:^|\s)bearer\s+[A-Za-z0-9._~+/-]{8,}/i.test(input) ||
    /[\\/]/.test(input) ||
    /:\/\//.test(input) ||
    /(?:^|\s)(?:islemind|node|npm|bun|pnpm|npx|git|python|python3|sh|bash|pwsh|cmd)\s/i.test(input) ||
    /[;&|`$]/.test(input)
  )
}
