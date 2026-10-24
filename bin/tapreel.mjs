#!/usr/bin/env node
// Tapreel CLI. Run it from the root of the app you are making a video for (or set TAPREEL_PROJECT).
//
//   tapreel init                     create <project>/tapreel/ with a starter config, script and scene
//   tapreel doctor                   check VoiceStudio, ffmpeg, the browser, the voice and the consent
//   tapreel consent                  the app owner approves exactly what the recorder will do
//   tapreel plan [--freeze]          script.json -> captions, timeline, shot list
//   tapreel narrate [flags]          render the narration (--synth-only, --mix-only, --redo-flagged)
//   tapreel record [--scenes 1,3]    record the app, scene by scene, against the timeline
//   tapreel build [clips|assets|compose]  compose the film
//   tapreel check [film.mp4]         transcribe the finished film against the script
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const [cmd, ...rest] = process.argv.slice(2)
const run = (file, args = []) => {
  const r = spawnSync(process.execPath, [join(here, file), ...args], { stdio: 'inherit', env: process.env })
  if (r.status) process.exit(r.status)
}
const flag = (name) => {
  const i = rest.indexOf(name)
  return i < 0 ? undefined : (rest[i + 1]?.startsWith('--') ? true : (rest[i + 1] ?? true))
}

if (cmd === 'init') {
  const { videoDir, projectRoot, dirName } = await import('./lib/config.mjs')
  const tpl = join(here, '..', 'templates')
  mkdirSync(join(videoDir, 'scenes'), { recursive: true })
  for (const [from, to] of [['tapreel.config.json', 'tapreel.config.json'], ['script.json', 'script.json'], ['scene.mjs', 'scenes/welcome.mjs'], ['hooks.mjs', 'hooks.mjs']]) {
    const dest = join(videoDir, to)
    if (existsSync(dest)) console.log('kept   ', join(dirName, to))
    else {
      writeFileSync(dest, readFileSync(join(tpl, from)))
      console.log('created', join(dirName, to))
    }
  }
  const gi = join(projectRoot, '.gitignore')
  const want = ['.tapreel-work/', `${dirName}/audio/`, `${dirName}/out/`]
  const have = existsSync(gi) ? readFileSync(gi, 'utf8') : ''
  const add = want.filter((w) => !have.includes(w))
  if (add.length) appendFileSync(gi, (have.endsWith('\n') || !have ? '' : '\n') + add.join('\n') + '\n')
  console.log('\nNext: edit tapreel/tapreel.config.json (app name, URL, access), then: tapreel doctor')
} else if (cmd === 'doctor') {
  run('doctor.mjs')
} else if (cmd === 'consent') {
  const { giveConsent } = await import('./lib/consent.mjs')
  await giveConsent({ by: typeof flag('--by') === 'string' ? flag('--by') : undefined, yes: rest.includes('--yes') })
} else if (cmd === 'plan') {
  run('build-video-srt.mjs', rest)
} else if (cmd === 'narrate') {
  run('build-narration.mjs', rest)
} else if (cmd === 'record') {
  const { record } = await import('./record.mjs')
  const s = flag('--scenes')
  await record({ scenes: typeof s === 'string' ? s.split(',').map(Number) : undefined })
} else if (cmd === 'build') {
  run('build-video.mjs', rest)
} else if (cmd === 'check') {
  run('check-film-audio.mjs', rest)
} else {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(2, 14).join('\n').replace(/^\/\/ ?/gm, ''))
  process.exit(cmd ? 1 : 0)
}
