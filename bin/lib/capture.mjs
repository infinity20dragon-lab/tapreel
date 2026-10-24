import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { videoDir, workDir } from './config.mjs'

export const WORK = workDir
export const loadTimeline = () => JSON.parse(readFileSync(join(videoDir, 'timeline.json'), 'utf8'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Records a page with Chrome's screencast: real frames at device resolution, timestamped by the browser, written as
 * JPEGs. Playwright's own recordVideo is capped near 1 Mbit/s, which turns small text to mush. Frames are only produced
 * when the screen changes, so the compose step holds each one until the next.
 */
export class Capture {
  frames = []
  cdp = null
  n = 0
  t0 = 0
  running = false
  constructor(dir, size) {
    this.dir = dir
    this.size = size
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
  }
  begin() {
    this.t0 = Date.now() / 1000
    this.running = true
  }
  save(b64, t) {
    const file = `${String(this.n++).padStart(6, '0')}.jpg`
    writeFileSync(join(this.dir, file), Buffer.from(b64, 'base64'))
    this.frames.push({ t: Math.max(0, t), file })
  }
  async attach(page) {
    await this.detach()
    await page.bringToFront()
    const cdp = await page.context().newCDPSession(page)
    this.cdp = cdp
    cdp.on('Page.screencastFrame', (f) => {
      const now = Date.now() / 1000
      const ts = f.metadata.timestamp
      const stamp = ts && Math.abs(ts - now) < 5 ? ts : now // the browser's clock is the truth if it is epoch-based
      if (this.running) this.save(f.data, stamp - this.t0)
      void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined)
    })
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: this.size.w, maxHeight: this.size.h, everyNthFrame: 1 })
    // A still screen sends no frames, so take one now. If the browser refuses, the first screencast frame stands in.
    try {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90 })
      if (this.running) this.save(shot.data, Date.now() / 1000 - this.t0)
    } catch {}
  }
  async detach() {
    if (!this.cdp) return
    await this.cdp.send('Page.stopScreencast').catch(() => undefined)
    await this.cdp.detach().catch(() => undefined)
    this.cdp = null
  }
  async finish(duration) {
    await this.detach()
    this.running = false
    this.frames.sort((a, b) => a.t - b.t)
    writeFileSync(join(this.dir, 'frames.json'), JSON.stringify({ duration, frames: this.frames }))
  }
}

/** What a scene script gets: a clock locked to the narration, and the capture. */
export class SceneClock {
  late = []
  started = 0
  constructor(scene, cues, cap) {
    this.scene = scene
    this.cues = cues
    this.cap = cap
  }
  get duration() { return this.scene.end - this.scene.start }
  get now() { return (Date.now() - this.started) / 1000 }
  async start(page) {
    this.cap.begin()
    this.started = Date.now()
    await this.cap.attach(page)
  }
  /** Carry on recording from a different page. The clock does not restart. */
  async switchTo(page) { await this.cap.attach(page) }
  /** Scene time of a narration cue (matched by the start of its text), plus an offset in seconds. */
  cue(prefix, offset = 0) {
    const c = this.cues.find((x) => x.scene === this.scene.id && x.text.startsWith(prefix))
    if (!c) throw new Error(`no cue starting "${prefix}" in scene ${this.scene.id}`)
    return c.start - this.scene.start + offset
  }
  /** Milliseconds between two cue moments: how long a movement may take before the next cue needs us. */
  gap(fromPrefix, fromOffset, toPrefix, toOffset) {
    return Math.max(600, (this.cue(toPrefix, toOffset) - this.cue(fromPrefix, fromOffset)) * 1000)
  }
  /** Waits until the scene clock reaches `sec`; notes it if we are already late. */
  async at(sec, label = '') {
    const wait = sec * 1000 - (Date.now() - this.started)
    if (wait > 0) await sleep(wait)
    else if (wait < -400) this.late.push(`${label || 'step'} ${(-wait / 1000).toFixed(1)}s late at ${sec.toFixed(1)}s`)
  }
  async finish() {
    await this.at(this.duration, 'end of scene')
    await this.cap.finish(this.duration)
  }
}

/** Runs one step; a missing element must never stop a scene that is running against the clock. */
export async function safe(S, label, fn) {
  try {
    await fn()
  } catch (e) {
    S.late.push(`${label} FAILED: ${String(e.message).split('\n')[0]}`)
  }
}

// ---- things a person does on a screen ------------------------------------------------------------
const v = (page, name, args) => page.evaluate(([n, a]) => window.__v[n](...a), [name, args])

export async function ring(page, target, label, ms = 2400, num) {
  const el = target.first()
  let box = await el.boundingBox({ timeout: 4000 })
  const vh = page.viewportSize()?.height ?? 844
  // Off screen, or under a header or tab bar: bring it to the middle, let the page settle, then measure again.
  if (!box || box.y < 90 || box.y + box.height > vh - 80) {
    await el.evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'instant' }))
    await page.waitForTimeout(400)
    box = await el.boundingBox({ timeout: 4000 })
  }
  if (!box) throw new Error(`no box for "${label}"`)
  await v(page, 'ring', [box, label, ms, num])
}

/** A touch on a phone layout, a click on a desktop one. */
export async function tap(target) {
  try {
    await target.first().tap({ timeout: 6000 })
  } catch (e) {
    if (!/hasTouch/.test(String(e.message))) throw e
    await target.first().click({ timeout: 6000 })
  }
}

export async function typeSlowly(target, text, delay = 85) {
  await tap(target)
  await target.first().pressSequentially(text, { delay })
}

/** Eased scroll of the page, so it reads like a thumb, not a jump. */
export const glide = (page, dy, ms) =>
  page.evaluate(
    ([d, t]) =>
      new Promise((done) => {
        const start = performance.now()
        const from = window.scrollY
        const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2)
        const step = (now) => {
          const p = Math.min(1, (now - start) / t)
          window.scrollTo(0, from + d * ease(p))
          if (p < 1) requestAnimationFrame(step)
          else done()
        }
        requestAnimationFrame(step)
      }),
    [dy, ms],
  )

export const overlay = (page) => ({
  card: (title, items, y = 120) => v(page, 'card', [title, items, y]),
  reveal: (i) => v(page, 'reveal', [i]),
  off: () => v(page, 'cardOff', []),
  ripple: (x, y) => v(page, 'ripple', [x, y]),
})
