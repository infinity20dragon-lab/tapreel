// Renders the narration with the local VoiceStudio app and assembles it on the film's timeline.
//
//   node scripts/build-narration.mjs                synthesize (cached) -> timeline -> mix
//   node scripts/build-narration.mjs --synth-only
//   node scripts/build-narration.mjs --mix-only
//   node scripts/build-narration.mjs --redo-flagged re-render phrases that did not pass the checks
//   ONLY="start-of-shift-03" node scripts/build-narration.mjs --synth-only     re-render phrases whose id starts with that
//
// Needs VoiceStudio running (http://localhost:3900). Nothing leaves the machine.
//
// How a phrase is made (every caption cue, plus a spoken intro and outro):
//   * rendered through VoiceStudio's REST endpoint at maximum steps with the unprocessed preset (RENDER, lib/video-script.mjs);
//   * several takes with different seeds; the speed is nudged so the speaking rate matches the rest of the film. Audio is
//     never time-stretched afterwards, because that is what makes speech sound processed and the pace seem to wander;
//   * each take is transcribed by Whisper large with word timestamps and rejected for a stutter, an echoed or dropped
//     word, a stall, a dropout, a flat monotone delivery, or running past the room its caption leaves;
//   * the winner is trimmed, levelled and written to <project>/tapreel/audio/cues/<id>.wav.
// The phrase is placed where its caption starts. The timeline (scene and sentence lengths) is frozen in
// audio/slots.json, so the screen recording never has to be redone when the narration changes.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadScript, phrases, VOICE, RENDER, root, audioDir, videoDir, syllables } from './lib/video-script.mjs'
import { cfg } from './lib/config.mjs'
import { generate, transcribe, readWav, writeWav, speechBounds, pitchSpread, judgeWords, noiseFloorDb, strayBursts, quietInhale, RATE } from './lib/voicestudio.mjs'
import { ffmpeg } from './lib/ffmpeg.mjs'

const args = new Set(process.argv.slice(2))
// A calm, friendly how-to pace: about 170 words per minute (4.0 syllables a second). The voice's own pace is about 220.
const TARGET_RATE = 4.0
// RELAX=1 (second pass for stubborn phrases, usually very short ones or ones with spelled-out letters): the pace and
// liveliness gates are loosened, but a take must still pass Whisper's word-by-word check. SEED_SHIFT gives new seeds.
const RELAX = Boolean(process.env.RELAX)
const SEED_SHIFT = Number(process.env.SEED_SHIFT ?? 0)
const MAX_ATTEMPTS = 7
const RATE_BAND = 0.14 // a take may differ this much from the film's speaking rate
const MIN_PITCH_STD = 2.4 // semitones; below this a phrase of any length reads as a monotone
const TARGET_RMS = 0.1 // about -20 dBFS while speaking
const PEAK_LIMIT = 0.89
const PAD = 0.04 // seconds of room kept around the trimmed speech
const FADE = 0.008

const syl = (say) => say.split(/\s+/).reduce((n, w) => n + syllables(w), 0)
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
const timeline = () => JSON.parse(readFileSync(resolve(videoDir, 'timeline.json'), 'utf8'))
const log = (...a) => console.log(...a)

/** How much room each phrase has before the next one starts (seconds). */
function windows(list) {
  const tl = timeline()
  const out = {}
  for (const s of tl.scenes) {
    const cs = tl.cues.filter((c) => c.scene === s.id)
    cs.forEach((c, i) => {
      out[`${s.id}-${String(i + 1).padStart(2, '0')}`] = (i + 1 < cs.length ? cs[i + 1].start - 0.1 : s.end - 0.4) - c.start
    })
  }
  out.intro = tl.titleCard + 2.2 - 0.4 - (JSON.parse(readFileSync(resolve(videoDir, 'script.json'), 'utf8')).intro?.at ?? 1)
  out.outro = tl.endCard - 1.0 - (JSON.parse(readFileSync(resolve(videoDir, 'script.json'), 'utf8')).outro?.at ?? 1)
  return Object.fromEntries(list.map((p) => [p.id, out[p.id] ?? 8]))
}

function level(seg) {
  let sq = 0
  let peak = 0
  for (const v of seg) {
    sq += v * v
    peak = Math.max(peak, Math.abs(v))
  }
  const gain = Math.min(TARGET_RMS / Math.sqrt(sq / seg.length), PEAK_LIMIT / peak)
  const fade = Math.round(RATE * 0.012)
  const fadeOut = Math.round(RATE * 0.04)
  const out = Float32Array.from(seg)
  for (let i = 0; i < out.length; i++) {
    out[i] *= gain
    if (i < fade) out[i] *= i / fade
    if (out.length - 1 - i < fadeOut) out[i] *= (out.length - 1 - i) / fadeOut
  }
  return { out, gainDb: 20 * Math.log10(gain) }
}

function trim(samples) {
  // A low threshold and generous room: soft sounds at the edges of a word ("ly", "ss", "f") must survive. Stray bursts are
  // dealt with by rejecting the take, never by cutting.
  const { start, end } = speechBounds(samples, RATE, 0.01)
  const a = Math.max(0, Math.round((start - 0.06) * RATE))
  const b = Math.min(samples.length, Math.round((end + 0.14) * RATE))
  return { seg: samples.subarray(a, b), voiced: end - start }
}

async function render(p, speed, seed) {
  const wav = await generate({ text: p.say, profile_id: VOICE.profile_id, language: VOICE.language, ...RENDER, speed: speed.toFixed(3), seed })
  const { samples } = readWav(wav)
  const t = trim(samples)
  return { wav, ...t, pitch: pitchSpread(t.seg), stray: strayBursts(t.seg) }
}

async function makePhrase(p, room, targetRate) {
  const s = syl(p.say)
  let speed = RENDER.speed
  let best = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const seed = 3 + attempt * 11 + SEED_SHIFT
    const r = await render(p, speed, seed)
    const rate = s / r.voiced
    const dev = rate / targetRate - 1
    const fits = r.voiced <= room
    const lively = RELAX || r.voiced < 1.2 || r.pitch.std >= MIN_PITCH_STD
    // A burst before the first word or after the last, or speech cut off mid-sound, is a take we do not use.
    const clean = !r.stray.head && !r.stray.tail && !r.stray.abruptEnd
    let judged = { sim: 0, problems: ['not transcribed'], score: 0 }
    let heard = { text: '', words: [] }
    // Only spend a Whisper pass on a take that already has the right pace, fits its room and is not flat.
    if (Math.abs(dev) <= (RELAX ? 0.32 : RATE_BAND) && fits && lively && clean) {
      heard = await transcribe(r.wav)
      judged = judgeWords(p.say, heard, r.voiced)
      // Whisper takes a hiss or a murmur before the first word for part of that word, or leaves a gap of silence before it.
      const ws = heard.words.filter((w) => w.word)
      if (ws.length > 1) {
        const f = ws[0]
        if (f.end - f.start > 0.45 && syllables(f.word) <= 2) judged.problems.push(`noise or stall on the first word "${f.word}"`)
        if (f.start > 0.2) {
          const a = Math.round(0.05 * RATE)
          const b = Math.max(a + 1, Math.round((f.start - 0.08) * RATE))
          let peak = 0
          for (let i = a; i < Math.min(b, r.seg.length); i++) peak = Math.max(peak, Math.abs(r.seg[i]))
          if (20 * Math.log10(peak + 1e-7) > -42) judged.problems.push('sound before the first word')
        }
      }
    }
    const ok = judged.problems.length === 0 && judged.sim >= 0.94
    const score = (ok ? 2 : judged.score) - 1.2 * Math.abs(dev) - (fits ? 0 : 1) - (lively ? 0 : 0.3) - (clean ? 0 : 1.5)
    const cand = { attempt, seed, speed, rate, dev, voiced: r.voiced, seg: r.seg, pitchStd: r.pitch.std, ok, judged, heard, fits, lively, clean, stray: r.stray, score }
    if (!best || cand.score > best.score) best = cand
    if (ok) break
    // steer the next take: toward the film's rate, and shorter if it ran over its room
    let next = speed * Math.min(1.12, Math.max(0.88, targetRate / rate))
    if (!fits) next = Math.max(next, speed * (r.voiced / Math.max(0.5, room - 0.1)))
    speed = Math.min(1.1, Math.max(0.62, next))
  }
  return best
}

async function synth() {
  const script = loadScript()
  const list = phrases(script)
  mkdirSync(resolve(audioDir, 'cues'), { recursive: true })
  const jsonPath = resolve(audioDir, 'cues.json')
  const prior = existsSync(jsonPath) ? JSON.parse(readFileSync(jsonPath, 'utf8')).cues : {}
  const room = windows(list)
  const health = await (await fetch('http://127.0.0.1:3900/engines/tts')).json().then((j) => `${j.active} ${j.active_model}`)
  log(`VoiceStudio TTS: ${health}. Voice ${VOICE.profile_id}, ${RENDER.num_step} steps, preset ${RENDER.effect_preset}. ${list.length} phrases.\n`)
  const targetRate = TARGET_RATE
  log(`Target pace: ${targetRate} syllables/s (about ${Math.round((targetRate * 60) / 1.4)} wpm)
`)

  const cues = {}
  const flagged = []
  const only = process.env.ONLY
  for (const [i, p] of list.entries()) {
    const k = `${p.scene}-${p.scene === 'intro' || p.scene === 'outro' ? 1 : p.index}`
    const cached = prior[k]
    const redo = (only && only.split(',').some((o) => p.id.startsWith(o))) || (args.has('--redo-flagged') && cached && !cached.ok)
    if (cached && (only ? true : cached.key === p.key) && !redo && existsSync(resolve(audioDir, cached.file))) {
      cues[k] = cached
      continue
    }
    const b = await makePhrase(p, room[p.id], targetRate)
    const { out, gainDb } = level(b.seg)
    writeFileSync(resolve(audioDir, p.file), writeWav(out))
    cues[k] = {
      file: p.file, key: p.key, voiced: Number(b.voiced.toFixed(3)), rate: Number(b.rate.toFixed(2)), speed: Number(b.speed.toFixed(3)), seed: b.seed,
      pitchStd: Number(b.pitchStd.toFixed(2)), sim: Number(b.judged.sim.toFixed(3)), ok: b.ok, attempts: b.attempt, gainDb: Number(gainDb.toFixed(1)),
      room: Number(room[p.id].toFixed(2)), heard: b.heard.text, problems: b.judged.problems, clean: b.clean,
    }
    if (!b.ok) flagged.push({ p, b })
    log(`${String(i + 1).padStart(3)}/${list.length}  ${b.ok ? 'ok   ' : 'CHECK'} rate ${(b.dev >= 0 ? '+' : '') + (b.dev * 100).toFixed(0).padStart(3)}%  pitch ${b.pitchStd.toFixed(1)}  ${b.voiced.toFixed(1)}/${room[p.id].toFixed(1)}s  x${b.attempt}  ${p.say.slice(0, 54)}`)
  }
  writeFileSync(jsonPath, JSON.stringify({ meta: { voice: VOICE, render: RENDER, targetRate, generated: new Date().toISOString() }, cues }, null, 2) + '\n')

  const all = Object.values(cues)
  const rates = all.filter((c) => c.voiced > 1.4).map((c) => c.rate)
  const sd = Math.sqrt(rates.reduce((a, r) => a + (r - median(rates)) ** 2, 0) / rates.length)
  log(`\nPhrases: ${all.length}, passed every check: ${all.filter((c) => c.ok).length}`)
  log(`Speaking rate across phrases: median ${median(rates).toFixed(2)} syl/s, spread (std) ${((sd / median(rates)) * 100).toFixed(1)}%`)
  log(`Pitch movement: median ${median(all.map((c) => c.pitchStd)).toFixed(1)} semitones`)
  if (flagged.length) {
    log('\nPhrases that never passed every check (listen to these):')
    for (const { p, b } of flagged) log(`  [${p.file}] ${b.judged.problems.join('; ') || (b.fits ? '' : 'too long for its room')}\n     wanted: ${p.say}\n     heard:  ${b.heard.text}`)
  }
}

// ---- mix ----------------------------------------------------------------------------------------
function mix() {
  const tl = timeline()
  if (!tl.cueAudio?.length) throw new Error('timeline.json lists no narration audio; run synth first')
  const total = Math.ceil((tl.filmEnd + 1) * RATE)
  const master = new Float32Array(total)
  for (const c of tl.cueAudio) {
    const w = quietInhale(readWav(readFileSync(resolve(audioDir, c.file))).samples)
    const at = Math.round((c.start - PAD) * RATE)
    for (let i = 0; i < w.length; i++) if (at + i >= 0 && at + i < total) master[at + i] += w[i]
  }
  mkdirSync(resolve(audioDir, 'chapters'), { recursive: true })
  // Gentle mastering only: remove rumble, tame the loudest syllables a little, never clip. Loudness is set at the end.
  const raw = resolve(audioDir, 'master-raw.wav')
  writeFileSync(raw, writeWav(master.subarray(0, Math.ceil(tl.filmEnd * RATE))))
  const mastered = resolve(audioDir, `${cfg.slug}.narration.wav`)
  ffmpeg(['-i', raw, '-af', 'highpass=f=70,acompressor=threshold=0.09:ratio=2:attack=12:release=180:makeup=1.2,alimiter=limit=0.93', '-ar', String(RATE), '-ac', '1', '-c:a', 'pcm_s16le', mastered])
  const m = readWav(readFileSync(mastered)).samples
  tl.scenes.forEach((s, i) => {
    const a = Math.round(s.start * RATE)
    const b = Math.round(s.end * RATE)
    writeFileSync(resolve(audioDir, 'chapters', `${String(i + 1).padStart(2, '0')}-${s.id}.wav`), writeWav(m.subarray(a, b)))
  })
  let peak = 0
  for (const v of m) peak = Math.max(peak, Math.abs(v))
  log(`Mixed ${tl.cueAudio.length} phrases into ${cfg.slug}.narration.wav (${(tl.filmEnd / 60).toFixed(2)} min, ${RATE} Hz mono, peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS) and ${tl.scenes.length} chapter tracks. Noise floor ${noiseFloorDb(m.subarray(Math.round(0.1 * RATE), Math.round(1.0 * RATE))).toFixed(0)} dBFS before the first word.`)
}

const rebuildSrt = () => execFileSync(process.execPath, [resolve(dirname(fileURLToPath(import.meta.url)), 'build-video-srt.mjs')], { stdio: 'inherit', cwd: root })

if (args.has('--mix-only')) mix()
else if (args.has('--synth-only')) await synth()
else {
  rebuildSrt() // phrase windows come from the timeline
  await synth()
  log('\n--- timeline from the new audio ---\n')
  rebuildSrt()
  log('\n--- mixing ---\n')
  mix()
}
