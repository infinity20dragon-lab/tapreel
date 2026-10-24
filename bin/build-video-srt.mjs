// Builds the caption/narration files for the film from
// <project>/tapreel/${cfg.slug}.script.json:
//
//   <project>/tapreel/${cfg.slug}.srt            full film captions
//   <project>/tapreel/chapters/NN-<id>.srt       one SRT per scene, starting at 00:00:00,000
//   <project>/tapreel/${cfg.slug}.tts.txt        plain spoken text, one sentence per line, blank line between scenes
//   <project>/tapreel/${cfg.slug}.cues.csv       cue id, scene, start, end, spoken text
//   <project>/tapreel/${cfg.slug}-shot-list.md   timed scene table for recording and editing
//   <project>/tapreel/timeline.json              where every spoken unit starts (used to mix the narration track)
//
//   node tapreel plan
//
// Timing source: if <project>/tapreel/audio/units.json holds a measured length for every spoken unit (made by
// scripts/build-narration.mjs from the real VoiceStudio audio), the captions are timed from the audio.
// Otherwise they are estimated from syllable counts. Pauses between sentences come from the punctuation
// and the script's `hold` seconds either way.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadScript, unitsOf, speechSeconds, afterPause, videoDir, audioDir, SYL_PER_SEC } from './lib/video-script.mjs'
import { cfg } from './lib/config.mjs'

const script = loadScript()

const SCENE_LEAD = 2.2 // chapter title lower-third before the first word
const SCENE_TAIL = 1.0
const MIN_CUE = 1.2
const TRAIL = 0.4 // caption lingers a moment after the last word
const MAX_LINE = 42
const MAX_LINES = 2
const CPS_WARN = 17
const CPS_ERROR = 21
const MAX_CUE = 7.0

const pad = (n, w = 2) => String(n).padStart(w, '0')
function ts(sec) {
  const ms = Math.round(sec * 1000)
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`
}
const clock = (sec) => `${Math.floor(sec / 60)}:${pad(Math.floor(sec % 60))}`
const csv = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

function wrap(text) {
  if (text.length <= MAX_LINE) return [text]
  const words = text.split(' ')
  let best = null
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ')
    const b = words.slice(i).join(' ')
    if (a.length > MAX_LINE || b.length > MAX_LINE) continue
    const score = Math.max(a.length, b.length) - (/[,.:;?!]$/.test(a) ? 6 : 0)
    if (!best || score < best.score) best = { score, lines: [a, b] }
  }
  return best ? best.lines : null
}

// ---- measured audio, if any ---------------------------------------------------------------------
// Sentence lengths are FROZEN in slots.json: they are what the screen recording was made against, so new narration
// is fitted into them and never moves what is on screen. Per-phrase audio (cues.json) only sets how long a caption
// lingers and what the mixer places.
const slotsPath = resolve(audioDir, 'slots.json')
const slots = existsSync(slotsPath) ? JSON.parse(readFileSync(slotsPath, 'utf8')) : null
const cueAudioPath = resolve(audioDir, 'cues.json')
const cueAudio = existsSync(cueAudioPath) ? JSON.parse(readFileSync(cueAudioPath, 'utf8')).cues : {}
const sceneUnits = script.scenes.map((s) => unitsOf(s))
// A sentence's length: its frozen slot if it has one. A sentence without one (new or reworded) gets a slot sized like the
// rest of the film (the estimate), and never less than its own audio needs; it is frozen after the scene is recorded.
// (Deriving it from its own audio alone would shrink the slot with every retry.)
const audioNeeded = (unit, base) => {
  const parts = unit.lines.map((_, i) => cueAudio[`${unit.scene}-${base + i + 1}`]?.voiced)
  return parts.length && parts.every((x) => x !== undefined) ? parts.reduce((a, b) => a + b, 0) + 0.45 * (parts.length - 1) + 0.1 : 0
}
const useAudio = Boolean(slots || Object.keys(cueAudio).length)
let estimatedSentences = 0
const newSlots = {} // sentences that had no frozen slot this run; saved by --freeze

// ---- timeline -----------------------------------------------------------------------------------
const errors = []
const warnings = []
const cues = []
const scenes = []
const timeline = []
let t = script.titleCard
let cueNo = 0

for (const [si, scene] of script.scenes.entries()) {
  const start = t
  t += SCENE_LEAD
  const sceneCues = []
  for (const unit of sceneUnits[si]) {
    // Estimated shape of the sentence, used to split a measured length between its cues.
    const est = unit.lines.map((l, i) => {
      const say = l.say ?? l.text
      const inside = i < unit.lines.length - 1 ? afterPause(l.text) : 0
      return { speech: speechSeconds(say), weight: speechSeconds(say) + inside }
    })
    const estTotal = est.reduce((a, e) => a + e.weight, 0)
    const frozen = slots?.[`${unit.scene}-${unit.index}`]
    if (frozen === undefined) estimatedSentences++
    const total = frozen ?? Math.max(estTotal, audioNeeded(unit, sceneCues.length))
    if (frozen === undefined) newSlots[`${unit.scene}-${unit.index}`] = Number(total.toFixed(3))
    const unitStart = t
    let cum = 0
    unit.lines.forEach((line, i) => {
      let cueStart = unitStart + (total * cum) / estTotal
      const audio = cueAudio[`${scene.id}-${sceneCues.length + 1}`]
      const cueSpeech = audio?.voiced ?? (total * est[i].speech) / estTotal
      cum += est[i].weight
      // A pause inside a sentence should be a comma, not a dropout: when the new narration leaves a long gap before the
      // next phrase of the same sentence, that phrase starts earlier (never more than 0.9 s), leaving about half a second.
      const prev = i > 0 ? sceneCues.at(-1) : null
      if (prev && audio) {
        const gap = cueStart - (prev.start + prev.speech)
        if (gap > 0.8) cueStart -= Math.min(gap - 0.5, 0.9)
      }
      const cue = {
        audio: audio?.file,
        n: ++cueNo,
        scene: scene.id,
        text: line.text,
        say: line.say ?? line.text,
        start: cueStart,
        speech: cueSpeech,
        // on screen for as long as it takes to say it, and never less than it takes to read it (about 15 characters a second)
        end: cueStart + Math.max(cueSpeech + TRAIL, MIN_CUE, line.text.length / 15),
        hold: line.hold ?? 0,
      }
      sceneCues.push(cue)
      cues.push(cue)
    })
    const holds = unit.lines.reduce((a, l) => a + (l.hold ?? 0), 0)
    timeline.push({ scene: scene.id, sentence: unit.index, start: unitStart, voiced: total, say: unit.say })
    t += total + afterPause(unit.lines.at(-1).text) + holds
  }
  for (let i = 0; i < sceneCues.length - 1; i++) sceneCues[i].end = Math.min(sceneCues[i].end, sceneCues[i + 1].start - 0.05)
  t += SCENE_TAIL
  scenes.push({ ...scene, index: si, start, end: t, cues: sceneCues })
  if (si < script.scenes.length - 1) t += script.sceneGap
}
const filmEnd = t + script.endCard

// The spoken intro and outro sit on the title and end cards.
function bookend(kind, at, spec) {
  if (!spec) return null
  const audio = cueAudio[`${kind}-1`]
  const start = at + spec.at
  const speech = audio?.voiced ?? speechSeconds(spec.say ?? spec.text)
  return { audio: audio?.file, scene: kind, text: spec.text, say: spec.say ?? spec.text, start, speech, end: start + Math.max(speech + TRAIL, MIN_CUE), hold: 0 }
}
const introCue = bookend('intro', 0, script.intro)
const outroCue = bookend('outro', filmEnd - script.endCard, script.outro)
// (audio only: the title and end cards carry no captions)

// --freeze: record the lengths just used for sentences that had none, once the scene has been recorded against them.
if (process.argv.includes('--freeze') && Object.keys(newSlots).length) {
  writeFileSync(slotsPath, JSON.stringify({ ...(slots ?? {}), ...newSlots }, null, 2) + '\n')
  console.log(`Froze ${Object.keys(newSlots).length} sentence slots in audio/slots.json`)
}

// ---- checks -------------------------------------------------------------------------------------
for (const c of cues) {
  const lines = wrap(c.text)
  if (!lines || lines.length > MAX_LINES) {
    errors.push(`cue ${c.n} cannot fit ${MAX_LINES} lines of ${MAX_LINE} characters: "${c.text}"`)
    continue
  }
  c.lines = lines
  const dur = c.end - c.start
  c.cps = c.text.length / dur
  if (dur > MAX_CUE) errors.push(`cue ${c.n} is ${dur.toFixed(1)}s (max ${MAX_CUE}s): "${c.text}"`)
  if (c.cps > CPS_ERROR) warnings.push(`cue ${c.n} reads at ${c.cps.toFixed(1)} chars/s (fast!): "${c.text}"`)
  else if (c.cps > CPS_WARN) warnings.push(`cue ${c.n} reads at ${c.cps.toFixed(1)} chars/s: "${c.text}"`)
}
for (let i = 1; i < cues.length; i++) {
  if (cues[i].start < cues[i - 1].end) errors.push(`cue ${cues[i].n} starts before cue ${cues[i - 1].n} ends`)
}
if (errors.length) {
  console.error(errors.map((e) => `ERROR ${e}`).join('\n'))
  process.exit(1)
}

// ---- outputs ------------------------------------------------------------------------------------
function srt(list, offset = 0) {
  return list.map((c, i) => `${i + 1}\n${ts(c.start - offset)} --> ${ts(c.end - offset)}\n${c.lines.join('\n')}\n`).join('\n')
}

mkdirSync(resolve(videoDir, 'chapters'), { recursive: true })
writeFileSync(resolve(videoDir, `${cfg.slug}.srt`), srt(cues))
for (const s of scenes) writeFileSync(resolve(videoDir, 'chapters', `${pad(s.index + 1)}-${s.id}.srt`), srt(s.cues, s.start))
writeFileSync(resolve(videoDir, `${cfg.slug}.tts.txt`), sceneUnits.map((us) => us.map((u) => u.say).join('\n')).join('\n\n') + '\n')
writeFileSync(
  resolve(videoDir, `${cfg.slug}.cues.csv`),
  ['cue,scene,start,end,hold_after_s,spoken_text', ...cues.map((c) => [c.n, c.scene, ts(c.start), ts(c.end), c.hold, csv(c.say)].join(','))].join('\n') + '\n',
)
writeFileSync(
  resolve(videoDir, 'timeline.json'),
  JSON.stringify({ filmEnd, titleCard: script.titleCard, endCard: script.endCard, scenes: scenes.map((s) => ({ id: s.id, title: s.title, start: s.start, end: s.end })), cues: cues.map((c) => ({ n: c.n, scene: c.scene, text: c.text, start: c.start, end: c.end })), cueAudio: [introCue, ...cues, outroCue].filter((c) => c && c.audio).map((c) => ({ scene: c.scene, file: c.audio, start: c.start, voiced: c.speech })), units: timeline, timingSource: useAudio ? 'measured audio' : 'estimate' }, null, 2) + '\n',
)

const md = []
md.push(`# ${script.title ?? cfg.app.name}: shot list and timing`)
md.push('')
md.push('Generated by tapreel plan from script.json. Edit the JSON, not this file.')
md.push('')
md.push(`- **Runtime:** about ${clock(filmEnd)} including a ${script.titleCard}s title card and a ${script.endCard}s end card.`)
md.push(`- **Timing source:** ${useAudio ? 'measured from the generated VoiceStudio narration' : `estimated (${SYL_PER_SEC} syllables a second)`}, plus pauses from the punctuation and the \`hold\` times below. Nothing is sped up.`)
md.push(`- **Captions:** at most ${MAX_LINES} lines of ${MAX_LINE} characters, ${MIN_CUE}s minimum on screen, reading speed kept under ${CPS_WARN} characters a second.`)
md.push(`- **Voice-over:** spoken text is in \`${cfg.slug}.tts.txt\` (one sentence per line, a blank line between scenes). Spelled-out words in the script's "say" field are for the voice; captions keep the normal spelling.`)
md.push('')
for (const s of scenes) {
  md.push(`## ${s.index + 1}. ${s.title}  (${clock(s.start)} to ${clock(s.end)})`)
  md.push('')
  if (s.action) md.push(`**On screen:** ${s.action}`)
  md.push('')
  if (s.callouts?.length) md.push(`**Callouts:** ${s.callouts.join(" / ")}`)
  md.push('')
  md.push('| Cue | Start | End | Narration | Hold after |')
  md.push('|---|---|---|---|---|')
  const short = (sec) => ts(sec).slice(3, 8) + '.' + ts(sec).slice(9)
  for (const c of s.cues) md.push(`| ${c.n} | ${short(c.start)} | ${short(c.end)} | ${c.text.replace(/\|/g, '/')} | ${c.hold ? c.hold + 's' : ''} |`)
  md.push('')
}
writeFileSync(resolve(videoDir, `${cfg.slug}-shot-list.md`), md.join('\n'))

// ---- report -------------------------------------------------------------------------------------
const words = cues.reduce((a, c) => a + c.say.split(/\s+/).filter(Boolean).length, 0)
const speechTotal = timeline.reduce((a, u) => a + u.voiced, 0)
const holdTotal = cues.reduce((a, c) => a + c.hold, 0)
const cps = cues.map((c) => c.cps)
console.log(`Timing from         ${useAudio ? 'MEASURED AUDIO' : 'estimate'}${estimatedSentences ? `  (${estimatedSentences} sentences still estimated)` : ''}`)
console.log(`Film runtime        ${clock(filmEnd)}  (cards ${script.titleCard + script.endCard}s, holds ${holdTotal.toFixed(0)}s)`)
console.log(`Scenes / cues       ${scenes.length} / ${cues.length}   (${timeline.length} spoken sentences)`)
console.log(`Words spoken        ${words}`)
console.log(`Speaking pace       ${((words / speechTotal) * 60).toFixed(0)} wpm while speaking`)
console.log(`Overall narration   ${((words / (filmEnd - script.titleCard - script.endCard)) * 60).toFixed(0)} wpm across the whole film, pauses and holds included`)
console.log(`Caption reading     avg ${(cps.reduce((a, b) => a + b, 0) / cps.length).toFixed(1)}, max ${Math.max(...cps).toFixed(1)} chars/s`)
for (const s of scenes) console.log(`  ${s.index + 1}. ${s.title.padEnd(22)} ${clock(s.start)} to ${clock(s.end)}  (${(s.end - s.start).toFixed(0)}s, ${s.cues.length} cues)`)
if (warnings.length) console.log('\nWarnings:\n' + warnings.map((w) => `  ${w}`).join('\n'))
else console.log('\nNo warnings.')
