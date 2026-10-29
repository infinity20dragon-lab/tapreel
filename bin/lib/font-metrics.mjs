// Text widths read straight from a TrueType file (cmap format 4 + hmtx), so titles can be wrapped and spaced by the film
// itself instead of by libass, whose automatic line spacing follows the font's full line box and looks loose on headings.
import { readFileSync } from 'node:fs'

export function loadFont(path) {
  const b = readFileSync(path)
  const tables = {}
  const n = b.readUInt16BE(4)
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16
    tables[b.toString('latin1', o, o + 4)] = b.readUInt32BE(o + 8)
  }
  const unitsPerEm = b.readUInt16BE(tables.head + 18)
  const metrics = b.readUInt16BE(tables.hhea + 34)
  const advance = (g) => b.readUInt16BE(tables.hmtx + Math.min(g, metrics - 1) * 4)
  // cmap: the Windows Unicode BMP subtable (platform 3, encoding 1), format 4.
  const cmap = tables.cmap
  let sub = null
  for (let i = 0; i < b.readUInt16BE(cmap + 2); i++) {
    const r = cmap + 4 + i * 8
    if (b.readUInt16BE(r) === 3 && b.readUInt16BE(r + 2) === 1) sub = cmap + b.readUInt32BE(r + 4)
  }
  if (sub === null || b.readUInt16BE(sub) !== 4) throw new Error(`${path}: no Unicode format-4 cmap`)
  const segs = b.readUInt16BE(sub + 6) / 2
  const ends = sub + 14
  const starts = ends + segs * 2 + 2
  const deltas = starts + segs * 2
  const ranges = deltas + segs * 2
  const glyph = (code) => {
    for (let i = 0; i < segs; i++) {
      if (code > b.readUInt16BE(ends + i * 2)) continue
      const start = b.readUInt16BE(starts + i * 2)
      if (code < start) return 0
      const delta = b.readInt16BE(deltas + i * 2)
      const ro = b.readUInt16BE(ranges + i * 2)
      if (!ro) return (code + delta) & 0xffff
      const g = b.readUInt16BE(ranges + i * 2 + ro + (code - start) * 2)
      return g ? (g + delta) & 0xffff : 0
    }
    return 0
  }
  /** Width of `text` in pixels at `size` px. */
  return (text, size) => [...text].reduce((w, ch) => w + advance(glyph(ch.codePointAt(0))), 0) * (size / unitsPerEm)
}

/**
 * Balanced word wrap: as few lines as a greedy wrap to `maxWidth` needs, with the words split so the widest line is as
 * narrow as possible ("A meeting, / in public", not "A meeting, in / public").
 */
export function wrap(text, measure, size, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean)
  const count = greedy(text, measure, size, maxWidth).length
  let best = null
  const search = (from, left, acc) => {
    if (left === 1) {
      const lines = [...acc, words.slice(from).join(' ')]
      const widest = Math.max(...lines.map((l) => measure(l, size)))
      if (!best || widest < best.widest) best = { lines, widest }
      return
    }
    for (let to = from + 1; to <= words.length - left + 1; to++) search(to, left - 1, [...acc, words.slice(from, to).join(' ')])
  }
  if (words.length <= 12) search(0, count, [])
  return best && best.widest <= maxWidth ? best.lines : greedy(text, measure, size, maxWidth)
}

function greedy(text, measure, size, maxWidth) {
  const lines = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (line && measure(next, size) > maxWidth) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}
