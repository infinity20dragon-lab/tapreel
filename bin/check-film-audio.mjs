// Listens to the finished film with VoiceStudio's Whisper: each chapter's words against the script, repeated words,
// long gaps, and (with the intro and outro) anything spoken where nothing should be.
//   node scripts/check-film-audio.mjs [film.mp4]
import { readFileSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { ffmpeg } from './lib/ffmpeg.mjs'
import { transcribe, tokens } from './lib/voicestudio.mjs'
import { videoDir } from './lib/video-script.mjs'
import { cfg } from './lib/config.mjs'

const film = resolve(process.argv[2] ?? join(videoDir, 'out', `${cfg.slug}.mp4`))
const tl = JSON.parse(readFileSync(join(videoDir, 'timeline.json'), 'utf8'))
const tmp = mkdtempSync(join(tmpdir(), 'fa-'))

function diff(a, b) {
  const m = a.length, n = b.length
  const L = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const missing = [], extra = []
  let i = 0, j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) { i++; j++ } else if (L[i + 1][j] >= L[i][j + 1]) missing.push(a[i++])
    else extra.push(b[j++])
  }
  while (i < m) missing.push(a[i++])
  while (j < n) extra.push(b[j++])
  return { missing, extra, kept: L[0][0] }
}

async function listen(a, b) {
  const f = join(tmp, `s${Math.round(a * 1000)}.wav`)
  ffmpeg(['-ss', a.toFixed(2), '-t', (b - a).toFixed(2), '-i', film, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', f])
  return transcribe(readFileSync(f))
}

const sections = [{ id: 'intro', title: 'Intro', start: 0, end: tl.titleCard + 1.5, want: tl.cues.filter((c) => c.scene === 'intro').map((c) => c.text) }]
for (const s of tl.scenes) sections.push({ id: s.id, title: s.title, start: s.start - 0.3, end: s.end + 0.3, want: tl.cues.filter((c) => c.scene === s.id).map((c) => c.text) })
sections.push({ id: 'outro', title: 'Outro', start: tl.filmEnd - tl.endCard, end: tl.filmEnd, want: [] })

let kept = 0, total = 0
for (const sec of sections) {
  const h = await listen(sec.start, sec.end)
  const words = h.words.map((w) => w.word)
  const dup = words.filter((w, i) => w.length >= 3 && w.toLowerCase() === (words[i + 1] ?? '').toLowerCase())
  const gaps = h.words.slice(1).map((w, i) => w.start - h.words[i].end).filter((g) => g > 3.5)
  const want = tokens(sec.want.join(' '))
  const got = tokens(h.text)
  if (sec.want.length) {
    const d = diff(want, got)
    kept += d.kept; total += want.length
    console.log(`${sec.title.padEnd(22)} ${d.kept}/${want.length} words (${((d.kept / want.length) * 100).toFixed(0)}%)  repeated words: ${dup.length ? dup.join(',') : 'none'}  missing: [${d.missing.join(' ')}]  extra: [${d.extra.join(' ')}]`)
  } else {
    console.log(`${sec.title.padEnd(22)} spoken: "${h.text.trim()}"  repeated: ${dup.length ? dup.join(',') : 'none'}`)
  }
}
console.log(`\nWords matching the script across all chapters: ${kept}/${total} (${((kept / total) * 100).toFixed(1)}%)`)
