// Checks everything Tapreel needs and says what is missing. It installs nothing: the tapreel-setup skill asks first.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cfg, configPath } from './lib/config.mjs'
import { problems, fingerprint } from './lib/consent.mjs'

const VS = process.env.VOICESTUDIO_URL ?? 'http://localhost:3900'
let missing = 0
const row = (ok, name, hint = '') => {
  console.log(`${ok ? 'ok     ' : 'MISSING'} ${name}${ok ? '' : hint ? '  -> ' + hint : ''}`)
  if (!ok) missing++
}

row(existsSync(configPath), 'tapreel/tapreel.config.json', 'run: tapreel init')

let profiles = null
try {
  const r = await fetch(`${VS}/profiles`, { signal: AbortSignal.timeout(4000) })
  profiles = r.ok ? await r.json() : null
} catch {
  profiles = null
}
row(!!profiles, 'VoiceStudio running', `start it (https://github.com/debpalash/VoiceStudio) and check ${VS}`)
if (profiles) row(profiles.some((p) => p.id === cfg.voice.profileId), `voice profile "${cfg.voice.profileId || '(unset)'}"`, `set voice.profileId to one of: ${profiles.map((p) => `${p.id} (${p.name})`).join(', ')}`)

const ff = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' })
row(ff.status === 0, 'ffmpeg', 'install ffmpeg and put it on PATH')

let browser = false
try {
  const { chromium } = await import('playwright')
  browser = existsSync(chromium.executablePath())
} catch {
  browser = false
}
row(browser, 'Playwright + Chromium', 'npm install in the plugin folder, then: npx playwright install chromium')

const bad = problems().filter((x) => x !== '__hooks__')
row(!bad.length, 'access settings', bad.join('; '))
const c = cfg.access.consent
row(!!(c.acknowledgedBy && c.fingerprint === fingerprint()), 'owner consent for these access settings', 'run: tapreel consent')

console.log(missing ? `\n${missing} thing(s) to fix before recording.` : '\nAll set.')
process.exit(missing ? 1 : 0)
