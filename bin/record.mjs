// Records every scene against the narration timeline. Scene scripts live in <project>/tapreel/scenes/<scene id>.mjs:
//
//   export default async function ({ page, S, ui, cfg }) { ... }
//
// page: a Playwright page, already signed in. S: the scene clock (S.at(sec), S.cue('text', offset)).
// ui: ring, tap, typeSlowly, glide, overlay, safe. Optional <project>/tapreel/hooks.mjs: before(), after(), login().
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cfg, videoDir, workDir } from './lib/config.mjs'
import { assertConsent, problems, originAllowed } from './lib/consent.mjs'
import { overlayScript } from './lib/overlay.mjs'
import { Capture, SceneClock, glide, loadTimeline, overlay, ring, safe, tap, typeSlowly } from './lib/capture.mjs'

export async function record({ scenes: only } = {}) {
  assertConsent()
  const a = cfg.access
  const bad = problems(a)
  const needHooks = bad.includes('__hooks__')
  const real = bad.filter((x) => x !== '__hooks__')
  if (real.length) throw new Error('Cannot record:\n - ' + real.join('\n - '))
  let hooks = {}
  const hooksFile = join(videoDir, 'hooks.mjs')
  if (existsSync(hooksFile)) hooks = await import(pathToFileURL(hooksFile).href)
  if (needHooks && !(hooks.before && hooks.after)) throw new Error('access.dataChanges is "restored-by-hooks" but tapreel/hooks.mjs does not export before() and after()')

  const user = process.env[a.usernameEnv]
  const pass = process.env[a.passwordEnv]
  if (a.mode === 'demo-account' && (!user || !pass)) throw new Error(`Set $${a.usernameEnv} and $${a.passwordEnv} to the demo account sign-in (they are read from the environment only).`)

  const { chromium } = await import('playwright')
  const tl = loadTimeline()
  const device = { ...cfg.device, baseURL: a.baseUrl, serviceWorkers: 'block' }
  const vp = cfg.device.viewport
  const size = { w: vp.width * cfg.device.deviceScaleFactor, h: vp.height * cfg.device.deviceScaleFactor }
  const script = overlayScript({ accent: cfg.brand.accent, masks: cfg.masks ?? [] })
  const browser = await chromium.launch({ headless: a.headless })
  mkdirSync(workDir, { recursive: true })
  const authFile = join(workDir, 'auth.json')
  const blocked = new Set()

  const newContext = async (withLogin) => {
    const ctx = await browser.newContext({ ...device, ...(withLogin ? { storageState: authFile } : {}) })
    // The guard: the recorder can only reach the origins the owner approved.
    await ctx.route('**/*', (route) => {
      const u = route.request().url()
      if (/^(data|blob|about):/.test(u)) return route.continue()
      let origin = ''
      try {
        origin = new URL(u).origin
      } catch {
        return route.abort()
      }
      if (originAllowed(a.allowedOrigins, origin)) return route.continue()
      blocked.add(origin)
      return route.abort()
    })
    await ctx.addInitScript(script)
    return ctx
  }

  try {
    if (hooks.before) await hooks.before({ cfg })
    if (a.mode === 'demo-account') {
      const ctx = await newContext(false)
      const page = await ctx.newPage()
      if (hooks.login) await hooks.login({ page, user, pass, cfg })
      else {
        await page.goto(a.loginUrl)
        await page.locator('input[type=email], input[name=email], input[name=username], input[type=text]').first().fill(user)
        await page.locator('input[type=password]').first().fill(pass)
        await page.locator('button[type=submit], input[type=submit]').first().click()
        await page.waitForLoadState('networkidle')
      }
      await ctx.storageState({ path: authFile })
      await ctx.close()
    }
    for (const [i, scene] of tl.scenes.entries()) {
      if (only && !only.includes(i + 1)) continue
      const file = join(videoDir, 'scenes', `${scene.id}.mjs`)
      if (!existsSync(file)) throw new Error(`Missing scene script ${file}`)
      const mod = await import(pathToFileURL(file).href)
      const ctx = await newContext(a.mode === 'demo-account')
      const page = await ctx.newPage()
      await page.goto('/')
      const cues = tl.cues.filter((c) => c.scene === scene.id)
      const cap = new Capture(join(workDir, scene.id), size)
      const S = new SceneClock(scene, cues, cap)
      console.log(`recording ${i + 1}/${tl.scenes.length} ${scene.id} (${S.duration.toFixed(0)}s)`)
      await S.start(page)
      await mod.default({ page, ctx, S, cfg, ui: { ring, tap, typeSlowly, glide, overlay: overlay(page), safe: (label, fn) => safe(S, label, fn) } })
      await S.finish()
      for (const l of S.late) console.log('  note:', l)
      await ctx.close()
    }
  } finally {
    if (hooks.after) await hooks.after({ cfg }).catch((e) => console.error('after() failed:', e.message))
    await browser.close()
    if (blocked.size) console.log(`
Blocked (not in access.allowedOrigins): ${[...blocked].join(', ')}
If the app needs one to look right, ask the app owner, add it to the config and approve again with: tapreel consent`)
  }
}
