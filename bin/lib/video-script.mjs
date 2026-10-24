// Shared by scripts/build-video-srt.mjs and scripts/build-narration.mjs: loads the film script,
// groups its caption cues into spoken units, and holds the pacing model.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

import { projectRoot, videoDir as vdir, cfg } from './config.mjs'
export const root = projectRoot
export const videoDir = vdir
export const audioDir = resolve(videoDir, 'audio')

export const loadScript = () => JSON.parse(readFileSync(resolve(videoDir, 'script.json'), 'utf8'))

// ---- pacing model (used for estimates, and to weight cues inside a unit) ------------------------
export const SYL_PER_SEC = 3.7
export const PAUSE_COMMA = 0.18
export const PAUSE_SENTENCE_INSIDE = 0.45
export const AFTER = { '.': 0.5, '!': 0.5, '?': 0.5, ',': 0.2, ':': 0.2, ';': 0.2 }
export const AFTER_DEFAULT = 0.12

export function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '')
  if (!w) return 0
  if (w.length === 1) return 1 // spelled-out letters: "S M F D"
  let n = (w.match(/[aeiouy]+/g) ?? []).length
  if (w.endsWith('e') && !w.endsWith('le') && n > 1) n -= 1
  return Math.max(1, n)
}

export function speechSeconds(say) {
  const words = say.split(/\s+/).filter(Boolean)
  const syl = words.reduce((a, w) => a + syllables(w), 0)
  const inner = say.slice(0, -1)
  const commas = (inner.match(/[,:;]/g) ?? []).length
  const sentences = (inner.match(/[.!?](?=\s)/g) ?? []).length
  return syl / SYL_PER_SEC + commas * PAUSE_COMMA + sentences * PAUSE_SENTENCE_INSIDE
}

export const afterPause = (text) => AFTER[text.trim().slice(-1)] ?? AFTER_DEFAULT

// The narrator is a VoiceStudio profile (list: GET http://localhost:3900/profiles), set in tapreel.config.json as
// voice.profileId. For a real human voice, clone one with the person's consent (POST /profiles, kind=clone).
export const VOICE = { profile_id: cfg.voice.profileId, language: cfg.voice.language }

// How each phrase is rendered. Maximum steps and the unprocessed preset: the default "broadcast" preset compresses
// and brightens the voice into an obvious radio sound. The engine's natural pace is fast (about 220 wpm), so a gentle
// speed below 1 is used, and any further correction is made by choosing between takes, never by stretching audio.
// Bump to render every phrase again (4: takes with a stray burst are rejected instead of being cut).
export const TAKE_VERSION = 4
export const RENDER = { num_step: 64, effect_preset: 'raw', denoise: 'true', guidance_scale: 2, speed: 0.72, ...cfg.render }

// ---- spoken units -------------------------------------------------------------------------------
// A unit is one sentence: consecutive cues up to the one that ends in . ? or !. Speaking a whole
// sentence in one go keeps the intonation natural; the unit's measured length is then shared out
// between its cues so the captions still change phrase by phrase.
export function unitsOf(scene) {
  const units = []
  let cur = []
  for (const line of scene.lines) {
    cur.push(line)
    if (/[.!?]$/.test(line.text.trim())) {
      units.push(cur)
      cur = []
    }
  }
  if (cur.length) units.push(cur)
  return units.map((lines, i) => {
    const say = lines.map((l) => l.say ?? l.text).join(' ')
    return {
      scene: scene.id,
      index: i + 1,
      lines,
      say,
      key: createHash('sha1').update(JSON.stringify([say, VOICE])).digest('hex').slice(0, 12),
      file: `units/${scene.id}-${String(i + 1).padStart(2, '0')}.wav`,
    }
  })
}

/** Every phrase that is spoken, in film order: the intro, each caption cue, the outro. One audio file per entry. */
export function phrases(script) {
  const out = []
  if (script.intro) out.push({ id: 'intro', scene: 'intro', index: 1, text: script.intro.text, say: script.intro.say ?? script.intro.text, at: script.intro.at })
  for (const scene of script.scenes) {
    let i = 0
    for (const unit of unitsOf(scene)) {
      for (const line of unit.lines) {
        i++
        out.push({ id: `${scene.id}-${String(i).padStart(2, '0')}`, scene: scene.id, index: i, sentence: unit.index, text: line.text, say: line.say ?? line.text })
      }
    }
  }
  if (script.outro) out.push({ id: 'outro', scene: 'outro', index: 1, text: script.outro.text, say: script.outro.say ?? script.outro.text, at: script.outro.at })
  return out.map((p) => ({ ...p, file: `cues/${p.id}.wav`, key: createHash('sha1').update(JSON.stringify([p.say, VOICE, RENDER, TAKE_VERSION])).digest('hex').slice(0, 12) }))
}
