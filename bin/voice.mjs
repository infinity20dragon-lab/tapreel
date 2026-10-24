// Pick, design and audition the narrator voice.
//
//   tapreel voice list                         the voices VoiceStudio already has
//   tapreel voice presets                      ready-made voice designs to choose from
//   tapreel voice create <preset> [--name "Narrator"] [--accent "british accent"] [--use]
//   tapreel voice audition <profileId> [--text "..."]    render a short sample you can listen to
//   tapreel voice use <profileId>              write it into tapreel.config.json
//
// Designed voices are synthetic: made from a description, modelled on no real person. To use a real person's voice,
// clone it in VoiceStudio from a recording of someone who has agreed to it, then `tapreel voice use <id>`.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { configPath, videoDir } from './lib/config.mjs'
import { generate } from './lib/voicestudio.mjs'

const VS = process.env.VOICESTUDIO_URL ?? 'http://localhost:3900'

// Gender, age, pitch as VoiceStudio's voice designer understands them.
export const PRESETS = {
  'man-young': { label: 'Young man, friendly', gender: 'male', age: 'young adult', pitch: 'high pitch' },
  'man-warm': { label: 'Man, warm and steady', gender: 'male', age: 'middle-aged', pitch: 'moderate pitch' },
  'man-deep': { label: 'Man, deep and calm', gender: 'male', age: 'middle-aged', pitch: 'low pitch' },
  'man-elder': { label: 'Older man, wise and slow', gender: 'male', age: 'elderly', pitch: 'low pitch' },
  'woman-young': { label: 'Young woman, bright', gender: 'female', age: 'young adult', pitch: 'high pitch' },
  'woman-warm': { label: 'Woman, warm and clear', gender: 'female', age: 'middle-aged', pitch: 'moderate pitch' },
  'woman-calm': { label: 'Woman, low and calm', gender: 'female', age: 'young adult', pitch: 'low pitch' },
  'woman-elder': { label: 'Older woman, gentle', gender: 'female', age: 'elderly', pitch: 'moderate pitch' },
  'teen-boy': { label: 'Teenage boy', gender: 'male', age: 'teenager', pitch: 'high pitch' },
  'teen-girl': { label: 'Teenage girl', gender: 'female', age: 'teenager', pitch: 'high pitch' },
  boy: { label: 'Young boy (child voice)', gender: 'male', age: 'child', pitch: 'very high pitch' },
  girl: { label: 'Young girl (child voice)', gender: 'female', age: 'child', pitch: 'very high pitch' },
}

const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i < 0 ? undefined : process.argv[i + 1]
}
const [sub, target] = process.argv.slice(2)
const SAMPLE = 'Hi there! This is how I sound. Tap the button, and you are all set.'

async function list() {
  const r = await fetch(`${VS}/profiles`)
  if (!r.ok) throw new Error(`VoiceStudio not reachable at ${VS}`)
  for (const p of await r.json()) console.log(`${String(p.id).padEnd(10)} ${p.name}`)
}

async function create(presetName) {
  const preset = PRESETS[presetName]
  if (!preset) throw new Error(`Unknown preset "${presetName}". Run: tapreel voice presets`)
  const accent = arg('--accent') ?? 'american accent'
  const name = arg('--name') ?? `Tapreel ${preset.label}`
  const instruct = [preset.gender, preset.age, preset.pitch, accent].join(', ')
  const vd = { Gender: preset.gender, Age: preset.age, Pitch: preset.pitch, Style: 'Auto', EnglishAccent: accent, ChineseDialect: 'Auto' }
  const fd = new FormData()
  fd.set('name', name)
  fd.set('kind', 'design')
  fd.set('language', 'English')
  fd.set('instruct', instruct)
  fd.set('vd_states', JSON.stringify(vd))
  const r = await fetch(`${VS}/profiles`, { method: 'POST', body: fd })
  if (!r.ok) throw new Error(`VoiceStudio refused: ${r.status} ${await r.text()}`)
  const p = await r.json()
  console.log(`created ${p.id}  ${name}  (${instruct})`)
  if (process.argv.includes('--use')) use(p.id)
  else console.log(`Listen first: tapreel voice audition ${p.id}   then: tapreel voice use ${p.id}`)
  return p.id
}

async function audition(id) {
  const text = arg('--text') ?? SAMPLE
  const wav = await generate({ text, profile_id: id, language: 'English', num_step: 64, effect_preset: 'raw', seed: 7 })
  const out = join(videoDir, `voice-sample-${id}.wav`)
  writeFileSync(out, wav)
  console.log(`wrote ${out}`)
}

function use(id) {
  const raw = JSON.parse(readFileSync(configPath, 'utf8'))
  raw.voice = { ...(raw.voice ?? {}), profileId: id }
  writeFileSync(configPath, JSON.stringify(raw, null, 2) + '\n')
  console.log(`voice.profileId = ${id} in tapreel.config.json`)
}

if (sub === 'list') await list()
else if (sub === 'presets') for (const [k, v] of Object.entries(PRESETS)) console.log(`${k.padEnd(12)} ${v.label}`)
else if (sub === 'create') await create(target)
else if (sub === 'audition') await audition(target)
else if (sub === 'use') use(target)
else {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 9).join('\n').replace(/^\/\/ ?/gm, ''))
  process.exit(sub ? 1 : 0)
}
