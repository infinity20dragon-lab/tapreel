// Finds ffmpeg/ffprobe. winget installs them under %LOCALAPPDATA%\Microsoft\WinGet\Packages and only adds a PATH
// alias to NEW shells, so a session that was already open will not see `ffmpeg`.
import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function works(cmd) {
  const r = spawnSync(cmd, ['-version'], { encoding: 'utf8' })
  return r.status === 0
}

function search(dir, name, depth = 0) {
  if (depth > 5) return null
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return null
  }
  for (const e of entries) {
    const p = join(dir, e)
    if (e.toLowerCase() === name) return p
    try {
      if (statSync(p).isDirectory()) {
        const hit = search(p, name, depth + 1)
        if (hit) return hit
      }
    } catch {
      /* unreadable entry */
    }
  }
  return null
}

function find(name) {
  const env = process.env[name === 'ffmpeg' ? 'FFMPEG' : 'FFPROBE']
  if (env) return env
  if (works(name)) return name
  const base = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages')
  const hit = base && search(base, `${name}.exe`)
  if (hit) return hit
  throw new Error(`${name} not found. Install it with: winget install --id Gyan.FFmpeg -e`)
}

export const ffmpegPath = () => find('ffmpeg')
export const ffprobePath = () => find('ffprobe')

/** Runs ffmpeg; throws with the tail of stderr on failure. */
export function ffmpeg(args, opts = {}) {
  const r = spawnSync(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', maxBuffer: 1 << 28, ...opts })
  if (r.status !== 0) throw new Error(`ffmpeg failed (${r.status}): ${(r.stderr ?? '').split('\n').slice(-8).join('\n')}`)
  return r
}
