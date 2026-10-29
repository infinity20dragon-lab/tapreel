// Client and quality measurements for the local VoiceStudio app (http://localhost:3900, override with VS_BASE).
// REST is used instead of the MCP tool because it exposes what matters for narration: render steps, effect preset,
// duration (the model itself fits a sentence to a length, so nothing needs time-stretching afterwards), seed, and a
// large Whisper transcriber with word timestamps for checking every take.
import { syllables } from './video-script.mjs'

export const BASE = process.env.VS_BASE ?? 'http://127.0.0.1:3900'
export const RATE = 24000

// ---- generation ---------------------------------------------------------------------------------
export async function generate(fields) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) fd.set(k, String(v))
  const r = await fetch(`${BASE}/generate`, { method: 'POST', body: fd, signal: AbortSignal.timeout(300_000) })
  if (!r.ok) throw new Error(`generate ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return Buffer.from(await r.arrayBuffer())
}

export async function transcribe(wav) {
  const fd = new FormData()
  fd.set('file', new Blob([wav], { type: 'audio/wav' }), 'a.wav')
  fd.set('model', 'whisper-1')
  fd.set('response_format', 'verbose_json')
  fd.append('timestamp_granularities[]', 'word')
  fd.set('language', 'en')
  const r = await fetch(`${BASE}/v1/audio/transcriptions`, { method: 'POST', body: fd, signal: AbortSignal.timeout(300_000) })
  if (!r.ok) throw new Error(`transcribe ${r.status}`)
  const j = await r.json()
  return { text: String(j.text ?? ''), words: (j.words ?? []).map((w) => ({ word: String(w.word).trim(), start: w.start, end: w.end })) }
}

// ---- WAV (PCM 16-bit mono) ----------------------------------------------------------------------
export function readWav(buf) {
  let off = 12
  let fmt = null
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(off + 8), ch: buf.readUInt16LE(off + 10), rate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) }
    if (id === 'data') {
      const bytes = buf.subarray(off + 8, off + 8 + Math.min(size, buf.length - off - 8))
      const n = Math.floor(bytes.length / (fmt.bits / 8) / fmt.ch)
      const out = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        let sum = 0
        for (let c = 0; c < fmt.ch; c++) sum += fmt.format === 3 ? bytes.readFloatLE((i * fmt.ch + c) * 4) : bytes.readInt16LE((i * fmt.ch + c) * 2) / 32768
        out[i] = sum / fmt.ch
      }
      return { rate: fmt.rate, samples: out }
    }
    off += 8 + size + (size % 2)
  }
  throw new Error('no data chunk in WAV')
}

export function writeWav(samples, rate = RATE) {
  const buf = Buffer.alloc(44 + samples.length * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + samples.length * 2, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2)
  return buf
}

const frameRms = (s, rate, ms = 20) => {
  const w = Math.round((rate * ms) / 1000)
  const out = []
  for (let i = 0; i + w <= s.length; i += w) {
    let a = 0
    for (let j = 0; j < w; j++) a += s[i + j] ** 2
    out.push(Math.sqrt(a / w))
  }
  return out
}

/** Where speech starts and ends (seconds), relative to the loudest 20 ms frame. */
export function speechBounds(s, rate = RATE, rel = 0.03) {
  const rms = frameRms(s, rate)
  const th = Math.max(0.003, rel * Math.max(...rms))
  const first = rms.findIndex((v) => v > th)
  let last = rms.length - 1
  while (last > 0 && rms[last] <= th) last--
  return { start: first * 0.02, end: (last + 1) * 0.02 }
}

// ---- measurements -------------------------------------------------------------------------------
const dbfs = (x) => 20 * Math.log10(Math.max(x, 1e-7))

/** Level of whatever is not speech: the 200 ms before the first word and after the last, else the quietest decile. */
export function noiseFloorDb(s, rate = RATE) {
  const { start, end } = speechBounds(s, rate)
  const seg = [...s.subarray(0, Math.max(0, Math.round((start - 0.02) * rate))).slice(-Math.round(0.2 * rate)), ...s.subarray(Math.round((end + 0.02) * rate)).slice(0, Math.round(0.2 * rate))]
  if (seg.length > rate * 0.08) {
    let a = 0
    for (const v of seg) a += v * v
    return dbfs(Math.sqrt(a / seg.length))
  }
  const sorted = frameRms(s, rate).sort((a, b) => a - b)
  return dbfs(sorted[Math.floor(sorted.length * 0.1)])
}

/** Pitch movement in semitones (std and 5-95 % range). Flat, monotone speech scores low; lively speech scores higher. */
export function pitchSpread(s, rate = RATE) {
  const win = Math.round(rate * 0.04)
  const hop = Math.round(rate * 0.01)
  const lo = Math.round(rate / 300)
  const hi = Math.round(rate / 70)
  const f0 = []
  const peak = Math.max(...frameRms(s, rate))
  for (let i = 0; i + win + hi < s.length; i += hop) {
    let e = 0
    for (let j = 0; j < win; j++) e += s[i + j] ** 2
    if (Math.sqrt(e / win) < 0.15 * peak) continue
    let best = 0
    let bestLag = 0
    for (let lag = lo; lag <= hi; lag++) {
      let c = 0
      let e2 = 0
      for (let j = 0; j < win; j++) {
        c += s[i + j] * s[i + j + lag]
        e2 += s[i + j + lag] ** 2
      }
      const r = c / Math.sqrt(e * e2 + 1e-12)
      if (r > best) {
        best = r
        bestLag = lag
      }
    }
    if (best > 0.5) f0.push(rate / bestLag)
  }
  if (f0.length < 20) return { std: 0, range: 0, median: 0, voicedFrames: f0.length }
  const sorted = [...f0].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const st = f0.map((f) => 12 * Math.log2(f / median))
  const mean = st.reduce((a, b) => a + b, 0) / st.length
  const std = Math.sqrt(st.reduce((a, b) => a + (b - mean) ** 2, 0) / st.length)
  const s2 = [...st].sort((a, b) => a - b)
  return { std, range: s2[Math.floor(s2.length * 0.95)] - s2[Math.floor(s2.length * 0.05)], median, voicedFrames: f0.length }
}

// ---- reading the transcript ---------------------------------------------------------------------
const NUM = { 0: 'zero', 1: 'one', 2: 'two', 3: 'three', 4: 'four', 19: 'nineteen' }
export function tokens(s) {
  const raw = s.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).filter((t) => t !== 'dot').map((t) => NUM[t] ?? t)
  const out = []
  let inLetters = false
  for (const t of raw) {
    const one = /^[a-z]$/.test(t)
    if (one && inLetters) out[out.length - 1] += t
    else out.push(t)
    inLetters = one
  }
  return out
}

export function similarity(a, b) {
  const x = tokens(a).join('')
  const y = tokens(b).join('')
  const m = x.length
  const n = y.length
  if (!m && !n) return 1
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1))
    prev = cur
  }
  return 1 - prev[n] / Math.max(m, n)
}

/**
 * Judges a take from its word timings: repeated or echoed words, stalls (a word held far longer than its syllables
 * deserve), dropouts (a long silence in the middle of a phrase) and extra words. Returns problems and a 0..1 score.
 */
export function judgeWords(say, heard, voicedSeconds) {
  const problems = []
  const want = tokens(say)
  const got = tokens(heard.text)
  const sim = similarity(say, heard.text)
  if (sim < 0.93) problems.push(`transcript match ${sim.toFixed(2)}`)
  if (got.length > want.length) problems.push(`${got.length - want.length} extra word(s)`)
  const echoes = (t) => t.filter((w, i) => w.length >= 3 && (w === t[i + 1] || w === t[i + 2])).length
  if (echoes(got) > echoes(want)) problems.push('echoed word')

  const words = heard.words.filter((w) => w.word)
  const per = words.map((w) => (w.end - w.start) / Math.max(1, syllables(w.word)))
  const med = [...per].sort((a, b) => a - b)[Math.floor(per.length / 2)] || 0.2
  const stalls = words.filter((w, i) => per[i] > Math.max(0.55, 2.8 * med) && w.end - w.start > 0.7)
  if (stalls.length) problems.push(`stalled on "${stalls[0].word}"`)
  // pauses inside the phrase should sit at its commas; a long one anywhere else is a dropout
  const commas = (say.match(/[,;:]/g) ?? []).length + (say.slice(0, -1).match(/[.?!]/g) ?? []).length
  const gaps = words.slice(1).map((w, i) => w.start - words[i].end).filter((g) => g > 0.55)
  if (gaps.length > commas) problems.push(`${gaps.length - commas} unexpected pause(s) of ${Math.max(...gaps).toFixed(1)}s`)
  return { sim, problems, score: Math.max(0, sim - 0.2 * problems.length) }
}

// ---- cleaning the ends of a phrase --------------------------------------------------------------
/**
 * The engine often adds a short hissy burst after the last word (and now and then a puff before the first): a separate
 * sound, about 0.2 s long and not much quieter than the speech, set apart from the word by a clean gap below -50 dBFS.
 * A real word-final "s" has no such gap, so cutting at the first gap after the last word removes the artifact and
 * nothing that was said. `firstStart` and `lastEnd` (seconds) come from Whisper's word timestamps.
 */
export function cleanEnds(samples, firstStart, lastEnd, rate = RATE) {
  const w = Math.round(rate * 0.01)
  const db = []
  const hiss = [] // share of high-frequency energy: sibilants and noise are high, vowels are low
  for (let i = 0; i + w <= samples.length; i += w) {
    let e = 0
    let h = 0
    let prev = 0
    for (let j = 0; j < w; j++) {
      const x = samples[i + j]
      e += x * x
      h += (x - prev) ** 2
      prev = x
    }
    db.push(20 * Math.log10(Math.sqrt(e / w) + 1e-7))
    hiss.push(h / (e + 1e-12))
  }
  const GAP = -50
  const GAP_FRAMES = 3
  const AUDIBLE = -48
  const isGap = (i) => i + GAP_FRAMES <= db.length && db.slice(i, i + GAP_FRAMES).every((x) => x < GAP)
  let end = samples.length
  let start = 0
  let cutEnd = false
  let cutStart = false
  for (let i = Math.max(0, Math.floor(lastEnd / 0.01)); i < db.length; i++) {
    if (isGap(i)) {
      if (Math.max(...db.slice(i + GAP_FRAMES), -140) > AUDIBLE) {
        end = Math.min(samples.length, (i + 1) * w)
        cutEnd = true
      }
      break
    }
  }
  // Second signature, for bursts that are not set off by a deep gap: the sound after the word dips to a valley and then
  // RISES again by 8 dB or more for at least 60 ms. The end of a word only ever falls.
  if (!cutEnd) {
    const mean = (a, n) => db.slice(a, a + n).reduce((x, y) => x + y, 0) / Math.max(1, db.slice(a, a + n).length)
    for (let i = Math.max(0, Math.floor(lastEnd / 0.01) + 2); i < db.length - 8; i++) {
      const valley = mean(i, 3)
      if (valley > -34) continue
      let burst = -140
      for (let j = i + 3; j < db.length - 5; j++) burst = Math.max(burst, mean(j, 6))
      if (burst > -42 && burst - valley >= 8) {
        end = i * w
        cutEnd = true
        break
      }
    }
  }
  // Head: the first sound in the file is a short hissy burst, well below the speech, followed by a quiet valley. Whisper
  // often takes that burst for the first word (it did for "It" in "It opens full screen"), so its word times are not
  // used here. A word's own onset never looks like this: an "s" runs straight into its vowel with no valley, and a
  // plosive's closure comes before its burst, not after a sound.
  {
    const loud = db.filter((x) => x > -35)
    const speechLevel = loud.length ? loud.reduce((x, y) => x + y, 0) / loud.length : -20
    const f0 = db.findIndex((x) => x > -45)
    if (f0 >= 0) {
      for (let v = f0 + 1; v < Math.min(db.length - 3, f0 + 90); v++) {
        if (db[v] < -55 && db[v + 1] < -55) {
          const lead = db.slice(f0, v)
          const peak = Math.max(...lead)
          const hissShare = lead.filter((_, k) => hiss[f0 + k] > 1.2).length / lead.length
          const after = Math.max(...db.slice(v + 2), -140)
          if ((v - f0) * 0.01 <= 0.32 && peak <= speechLevel - 9 && hissShare >= 0.5 && after > speechLevel - 8) {
            let k = v + 2
            while (k < db.length && db[k] < -55) k++ // through the whole valley, up to the real word
            start = Math.min(end, Math.max(0, (k - 1) * w))
            cutStart = true
          }
          break
        }
      }
    }
  }
  const out = Float32Array.from(samples.subarray(start, end))
  const fadeOut = Math.min(out.length, Math.round(rate * 0.02))
  for (let i = 0; i < fadeOut; i++) out[out.length - 1 - i] *= i / fadeOut
  if (cutStart) {
    const fadeIn = Math.min(out.length, Math.round(rate * 0.012))
    for (let i = 0; i < fadeIn; i++) out[i] *= i / fadeIn
  }
  return { samples: out, cutEnd, cutStart, removedEnd: (samples.length - end) / rate, removedStart: start / rate }
}


/**
 * Silences the breath the voice takes before its first word, keeping the phrase's length (and so its timing on the film).
 * The intake is a long, quiet plateau (about -45 to -58 dB for a tenth of a second or more); a word's own onset rises from
 * silence to speech level within a few frames, and a hissy "s" or "f" is far louder than -38 dB, so both are left alone.
 */
export function quietInhale(samples, rate = RATE) {
  const w = Math.round(rate * 0.01)
  const n = Math.floor(samples.length / w)
  const db = []
  for (let i = 0; i < n; i++) {
    let sq = 0
    for (let k = i * w; k < (i + 1) * w; k++) sq += samples[k] * samples[k]
    db.push(10 * Math.log10(sq / w + 1e-12))
  }
  const speech = db.findIndex((x) => x > -35)
  if (speech < 0) return samples
  let onset = speech
  while (onset > 0 && speech - onset < 8 && db[onset - 1] > -45) onset--
  const lead = db.slice(0, onset)
  if (lead.filter((x) => x > -60).length < 8 || Math.max(...lead) > -38) return samples
  const out = Float32Array.from(samples)
  const end = Math.max(0, (onset - 2) * w)
  const fade = 2 * w
  for (let i = 0; i < end + fade && i < out.length; i++) out[i] *= i < end ? 0 : (i - end) / fade
  return out
}

// ---- spotting the engine's stray bursts (never editing the audio) --------------------------------
/**
 * The voice engine sometimes puts a separate hissy burst before the first word or after the last, about 0.1-0.4 s long
 * and well below the speech. Cutting it out risks cutting into a word (it clipped "address" and "instantly"), so takes
 * that have one are REJECTED and another take is rendered instead. Only a sound that is set apart from the speech by a gap
 * counts; a word's own "s" runs on from its vowel and does not.
 */
export function strayBursts(samples, rate = RATE) {
  const w = Math.round(rate * 0.01)
  const db = []
  const hiss = []
  for (let i = 0; i + w <= samples.length; i += w) {
    let e = 0
    let h = 0
    let prev = 0
    for (let j = 0; j < w; j++) {
      const x = samples[i + j]
      e += x * x
      h += (x - prev) ** 2
      prev = x
    }
    db.push(20 * Math.log10(Math.sqrt(e / w) + 1e-7))
    hiss.push(h / (e + 1e-12))
  }
  const loud = db.filter((x) => x > -35)
  const speechLevel = loud.length ? loud.reduce((a, b) => a + b, 0) / loud.length : -20
  // events: stretches above -45 dBFS; a single quiet frame does not split one
  const events = []
  for (let i = 0; i < db.length; ) {
    if (db[i] <= -45) {
      i++
      continue
    }
    let j = i
    while (j + 1 < db.length && (db[j + 1] > -45 || (j + 2 < db.length && db[j + 2] > -45))) j++
    const frames = db.slice(i, j + 1)
    events.push({ a: i, b: j, dur: (j - i + 1) * 0.01, peak: Math.max(...frames), hissy: frames.filter((_, k) => hiss[i + k] > 1.2).length / frames.length })
    i = j + 1
  }
  const result = { head: null, tail: null, speechLevel, abruptEnd: false }
  if (events.length >= 2) {
    const [e0, e1] = events
    const gap = e1.a - e0.b - 1
    if (e0.dur >= 0.1 && e0.dur <= 0.36 && e0.peak <= speechLevel - 10 && e0.hissy >= 0.5 && gap >= 2 && e1.peak >= speechLevel - 8) result.head = { dur: e0.dur, peak: e0.peak, gap: gap * 0.01 }
    const en = events.at(-1)
    const ep = events.at(-2)
    const gapT = en.a - ep.b - 1
    const valley = Math.min(...db.slice(ep.b + 1, en.a), 0)
    if (en.dur >= 0.1 && en.dur <= 0.42 && en.peak <= speechLevel - 6 && en.hissy >= 0.5 && gapT >= 3 && valley < -40 && ep.peak >= speechLevel - 8) result.tail = { dur: en.dur, peak: en.peak, gap: gapT * 0.01 }
  }
  // A take whose speech is still loud in its last 30 ms was cut off mid-sound.
  const last = db.slice(-5)
  result.abruptEnd = last.length === 5 && Math.max(...last) > speechLevel - 14
  return result
}
