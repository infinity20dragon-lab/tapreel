// Project settings. Tapreel runs from the app's own repo: it reads <project>/tapreel/tapreel.config.json and writes
// everything it makes (narration, frames, film) next to it. Nothing is written inside the plugin.
import { readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

export const projectRoot = resolve(process.env.TAPREEL_PROJECT ?? process.cwd())
export const dirName = process.env.TAPREEL_DIR ?? 'tapreel'
export const videoDir = join(projectRoot, dirName)
export const configPath = join(videoDir, 'tapreel.config.json')
export const workDir = join(projectRoot, '.tapreel-work')

const DEFAULTS = {
  slug: 'how-to',
  app: { name: 'My App', subtitle: 'How-to guide', url: '', org: '', icon: '▶' },
  introChips: [],
  outroChips: [],
  outroHelp: '',
  qrLabel: 'Scan to open',
  brand: { accent: '#2563eb', accentLight: '#bfdbfe', glow: '#60a5fa', bg: '#0b1220', muted: '#94a3b8' },
  fonts: { caption: 'Segoe UI Semibold', ui: 'Segoe UI', files: ['segoeui.ttf', 'segoeuib.ttf', 'seguisb.ttf'], dir: 'C:/Windows/Fonts' },
  device: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US' },
  voice: { profileId: '', language: 'English' },
  render: {},
  access: {
    mode: 'demo-account', // demo-account | public
    baseUrl: '',
    allowedOrigins: [],
    loginUrl: '/login',
    usernameEnv: 'TAPREEL_USER',
    passwordEnv: 'TAPREEL_PASS',
    accountIsDemo: false,
    dataChanges: 'none', // none | demo-data-only | restored-by-hooks
    headless: true,
    consent: { acknowledgedBy: '', date: '' },
  },
}

const merge = (a, b) => {
  if (Array.isArray(b) || typeof b !== 'object' || b === null) return b ?? a
  const out = { ...a }
  for (const k of Object.keys(b)) out[k] = k in a ? merge(a[k], b[k]) : b[k]
  return out
}

export function loadConfig({ required = true } = {}) {
  if (!existsSync(configPath)) {
    if (required) throw new Error(`No ${dirName}/tapreel.config.json in ${projectRoot}. Run: node <plugin>/bin/tapreel.mjs init`)
    return DEFAULTS
  }
  return merge(DEFAULTS, JSON.parse(readFileSync(configPath, 'utf8')))
}

export const cfg = loadConfig({ required: process.argv[2] !== 'init' })
export const hex = (c) => c.replace('#', '')
/** ASS colours are &HAABBGGRR */
export const assColor = (c) => {
  const h = hex(c)
  return `&H00${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase()
}
export const rgba = (c, a) => {
  const h = hex(c)
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`
}
