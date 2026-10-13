import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

it.each(['NotoSansSC', 'NotoSerifSC', 'LXGWWenKai'])('bundles %s as a regular static face instead of Android rendering a variable font minimum weight', (family) => {
  const font = readFileSync(resolve(__dirname, `../../assets/fonts/${family}.ttf`))
  const tables = new Map<string, number>()
  for (let index = 0; index < font.readUInt16BE(4); index++) {
    const entry = 12 + index * 16
    tables.set(font.toString('ascii', entry, entry + 4), font.readUInt32BE(entry + 8))
  }
  expect(tables.has('fvar')).toBe(false)
  expect(tables.has('OS/2')).toBe(true)
  expect(font.readUInt16BE(tables.get('OS/2')! + 4)).toBe(400)

  // The license must travel inside the font/APK, not just live beside source assets.
  const name = tables.get('name')!
  const strings = name + font.readUInt16BE(name + 4)
  const licenses: string[] = []
  for (let index = 0; index < font.readUInt16BE(name + 2); index++) {
    const entry = name + 6 + index * 12
    if (font.readUInt16BE(entry) !== 3 || font.readUInt16BE(entry + 6) !== 13) continue
    const length = font.readUInt16BE(entry + 8)
    const offset = strings + font.readUInt16BE(entry + 10)
    licenses.push(Buffer.from(font.subarray(offset, offset + length)).swap16().toString('utf16le'))
  }
  expect(licenses.some(text => text.includes('SIL OPEN FONT LICENSE') && text.includes('TERMINATION'))).toBe(true)
})
