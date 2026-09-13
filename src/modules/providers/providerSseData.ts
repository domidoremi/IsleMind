/** Shared data framing for answer text and citation metadata. The caller owns partial transport buffers. */
export function visitProviderSseData(
  chunk: string,
  appendPayload: (payload: string) => boolean,
): { sawDataLine: boolean; terminal: boolean; malformedData: boolean } {
  let sawDataLine = false
  let terminal = false
  let malformedData = false
  for (const event of chunk.replace(/\r\n|\r/g, '\n').split('\n\n')) {
    const payloads: string[] = []
    for (const line of event.split('\n')) {
      const match = /^data:(.*)$/.exec(line)
      if (!match) continue
      sawDataLine = true
      const payload = match[1].startsWith(' ') ? match[1].slice(1) : match[1]
      if (payload.trim() === '[DONE]') terminal = true
      else payloads.push(payload)
    }
    // Standards-compliant multiline fields first; retain the existing tolerance
    // for providers that send independent JSON lines without blank separators.
    if (payloads.length && !appendPayload(payloads.join('\n'))) {
      if (payloads.length === 1) malformedData = true
      else for (const payload of payloads) if (!appendPayload(payload)) malformedData = true
    }
  }
  return { sawDataLine, terminal, malformedData }
}
