// The recorder drives a real app with a real account, so it never starts without the owner's explicit, recorded consent.
// Consent is tied to what was agreed: change the target, the account type or the data policy and it must be given again.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { cfg, configPath } from './config.mjs'

const relevant = (a) => ({
  mode: a.mode,
  baseUrl: a.baseUrl,
  allowedOrigins: [...a.allowedOrigins].sort(),
  usernameEnv: a.usernameEnv,
  passwordEnv: a.passwordEnv,
  accountIsDemo: a.accountIsDemo,
  dataChanges: a.dataChanges,
  headless: a.headless,
})
/** An allowed origin is scheme + host + port ("https://app.example.com"), never a path: every page of an allowed site is allowed.
 *  "https://*.example.com" allows that site and all of its subdomains (but not other domains that merely end the same way). */
export function originAllowed(list, origin) {
  const o = new URL(origin)
  return list.some((entry) => {
    const star = entry.match(/^(https?):\/\/\*\.([^/:]+)(:\d+)?$/)
    if (!star) return entry === o.origin
    const [, scheme, base, port] = star
    return o.protocol === `${scheme}:` && (o.hostname === base || o.hostname.endsWith('.' + base)) && (port ?? '') === (o.port ? `:${o.port}` : '')
  })
}

export const fingerprint = (a = cfg.access) => createHash('sha256').update(JSON.stringify(relevant(a))).digest('hex').slice(0, 16)

const DATA = {
  none: 'none (read-only walkthrough)',
  'demo-data-only': 'demo data only',
  'restored-by-hooks': 'real rows that your hooks.mjs snapshots and restores',
}

export function summary(a = cfg.access) {
  return [
    'Tapreel will open this app in an automated browser and operate it like a person:',
    `  App:              ${a.baseUrl || '(not set)'}`,
    `  Only talks to:    ${a.allowedOrigins.join(', ') || '(not set)'}   (every other web address is blocked)`,
    `  Sign-in:          ${a.mode === 'demo-account' ? `demo account, name from $${a.usernameEnv}, password from $${a.passwordEnv} (never stored in files)` : 'none (public pages only)'}`,
    `  Account is demo:  ${a.accountIsDemo ? 'yes, confirmed' : 'NO - not confirmed'}`,
    `  Data it changes:  ${DATA[a.dataChanges] ?? a.dataChanges}`,
    `  Browser window:   ${a.headless ? 'hidden (headless)' : 'visible'}`,
    '  It records the screen to video, so anything shown on screen can end up in the film.',
  ].join('\n')
}

export function problems(a = cfg.access) {
  const p = []
  if (!a.baseUrl) p.push('access.baseUrl is not set')
  if (!a.allowedOrigins.length) p.push('access.allowedOrigins is empty')
  else if (a.baseUrl && !originAllowed(a.allowedOrigins, new URL(a.baseUrl).origin)) p.push('access.allowedOrigins must include the origin of baseUrl')
  if (a.mode === 'demo-account' && !a.accountIsDemo) p.push("access.accountIsDemo must be true: Tapreel only signs in with a demo account, never a real person's")
  if (!['demo-account', 'public'].includes(a.mode)) p.push('access.mode must be "demo-account" or "public"')
  if (a.dataChanges === 'restored-by-hooks') p.push('__hooks__')
  return p
}

export function assertConsent() {
  const a = cfg.access
  const c = a.consent
  if (!c.acknowledgedBy || !c.date || c.fingerprint !== fingerprint(a)) {
    console.error('\n' + summary(a) + '\n')
    console.error('No valid consent on file for exactly this setup. The owner of the app must approve it:\n  node tapreel.mjs consent\n')
    process.exit(2)
  }
}

export async function giveConsent({ by, yes }) {
  const a = cfg.access
  const bad = problems(a).filter((x) => x !== '__hooks__')
  if (bad.length) {
    console.error('Fix these first:\n - ' + bad.join('\n - '))
    process.exit(1)
  }
  console.log('\n' + summary(a) + '\n')
  let name = by
  if (!(yes && by)) {
    if (!process.stdin.isTTY) {
      console.error('Consent must be given by a person at a terminal (or by that person passing --yes --by "Their Name").')
      process.exit(2)
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const ok = (await rl.question('Do you own or manage this app and approve the above? (yes/no) ')).trim().toLowerCase()
    if (ok !== 'yes') {
      rl.close()
      console.error('Not approved. Tapreel cannot record this app.')
      process.exit(2)
    }
    name = (await rl.question('Your name: ')).trim()
    rl.close()
  }
  if (!name) throw new Error('A name is required')
  const raw = JSON.parse(readFileSync(configPath, 'utf8'))
  raw.access = { ...(raw.access ?? {}), consent: { acknowledgedBy: name, date: new Date().toISOString().slice(0, 10), fingerprint: fingerprint(a) } }
  writeFileSync(configPath, JSON.stringify(raw, null, 2) + '\n')
  console.log(`Consent recorded for ${name}.`)
}
