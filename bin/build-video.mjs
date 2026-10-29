// Turns the recorder's frames (tapreel record -> .tapreel-work/<scene>/) into the finished film.
//
//   node tapreel.mjs build clips            frames -> <work>/<scene>/raw.mp4 (30 fps, real timing)
//   node tapreel.mjs build sheet <scene>    contact sheet PNG of a scene, for a quick look
//   node tapreel.mjs build assets           backgrounds, phone frame, animated intro and outro
//   node tapreel.mjs build compose          each chapter and the full film
//   node tapreel.mjs build                  all of the above
//
// Layout (1920x1080): the phone on the left in a device frame, the narration as large captions on the right, a chapter
// label and progress at the top. Captions are burned in from the same timeline as the narration audio.
// Output: <project>/tapreel/out/ (git-ignored).
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { ffmpeg, ffprobePath } from './lib/ffmpeg.mjs'
import { root, videoDir, audioDir } from './lib/video-script.mjs'
import { cfg, workDir, hex, rgba, assColor } from './lib/config.mjs'

export const work = workDir
const compose = join(work, 'compose')
const out = join(videoDir, 'out')
const FPS = 30
const B = cfg.brand
const NAVY = hex(B.bg)
const APP = cfg.app
// Layout on the 1920x1080 canvas. Phone: a device frame on the left, captions on the right.
// Desktop: a window on the left, a narrower caption column on the right, headings above the window.
const DESK = cfg.device.kind === 'desktop'
const vp = cfg.device.viewport
const CLIP = { w: vp.width * cfg.device.deviceScaleFactor, h: vp.height * cfg.device.deviceScaleFactor }
const L = DESK
  ? { screen: { x: 60, y: 170, w: 1230, h: 692 }, capX: 1340, headX: 60, radius: 14, bezel: 10, capSize: 52, capMarginR: 60, titleSize: 84, eyebrowSize: 30 }
  : { screen: { x: 230, y: 70, w: 434, h: 940 }, capX: 820, headX: 820, radius: 48, bezel: 14, capSize: 68, capMarginR: 150, titleSize: 112, eyebrowSize: 34 }
const SCREEN = L.screen
const CAP_X = L.capX
const timeline = () => JSON.parse(readFileSync(join(videoDir, 'timeline.json'), 'utf8'))
const pad2 = (n) => String(n).padStart(2, '0')

// ---- frames -> clip -----------------------------------------------------------------------------
export function buildClip(id) {
  const dir = join(work, id)
  const { duration, frames } = JSON.parse(readFileSync(join(dir, 'frames.json'), 'utf8'))
  if (!frames.length) throw new Error(`${id}: no frames`)
  const lines = ['ffconcat version 1.0']
  for (let i = 0; i < frames.length; i++) {
    const t = i === 0 ? 0 : frames[i].t // the first frame stands from the very start
    const next = i + 1 < frames.length ? frames[i + 1].t : duration
    lines.push(`file '${frames[i].file}'`, `duration ${Math.max(0.001, next - t).toFixed(4)}`)
  }
  lines.push(`file '${frames.at(-1).file}'`)
  writeFileSync(join(dir, 'frames.ffconcat'), lines.join('\n') + '\n')
  ffmpeg([
    '-f', 'concat', '-safe', '0', '-i', join(dir, 'frames.ffconcat'),
    '-vf', `fps=${FPS},scale=${CLIP.w}:${CLIP.h}:flags=lanczos,format=yuv420p`,
    '-t', duration.toFixed(3), '-c:v', 'libx264', '-crf', '12', '-preset', 'veryfast', '-r', String(FPS), join(dir, 'raw.mp4'),
  ])
  return join(dir, 'raw.mp4')
}

export function contactSheet(id, cols = 6, rows = 3) {
  const dir = join(work, id)
  const { duration } = JSON.parse(readFileSync(join(dir, 'frames.json'), 'utf8'))
  const n = cols * rows
  const o = join(dir, 'sheet.png')
  ffmpeg(['-i', join(dir, 'raw.mp4'), '-vf', `fps=${(n / duration).toFixed(5)},scale=260:-1,tile=${cols}x${rows}`, '-frames:v', '1', o])
  return o
}

// ---- assets (drawn with the browser) ------------------------------------------------------------
const FONT = `'${cfg.fonts.ui}', system-ui, sans-serif`
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;')
const chipsHtml = (list) => list.map((c) => `<span class="chip" style="opacity:0">${esc(c)}</span>`).join('')

function bgHtml(n, total, title) {
  const pills = Array.from({ length: total }, (_, i) => `<span style="width:${i + 1 === n ? 64 : 28}px;height:10px;border-radius:5px;background:${i + 1 === n ? '${B.glow}' : 'rgba(148,163,184,.35)'}"></span>`).join('')
  return `<body style="margin:0;width:1920px;height:1080px;overflow:hidden;font-family:${FONT};color:#fff;background:#${NAVY}">
  <div style="position:absolute;inset:0;background:radial-gradient(900px 900px at 450px 540px,${rgba(B.accent,.42)},${rgba(B.accent,0)} 70%),linear-gradient(135deg,#${NAVY},#${NAVY} 60%,#${NAVY})"></div>
  <div style="position:absolute;left:0;top:0;bottom:0;width:10px;background:${B.accent}"></div>
  <div style="position:absolute;left:${L.headX}px;top:30px;display:flex;align-items:center;gap:14px;font-size:30px;font-weight:700">
    <span style="width:46px;height:46px;border-radius:14px;background:${B.accent};display:inline-flex;align-items:center;justify-content:center;font-size:26px">${esc(APP.icon)}</span>
    <span>${esc(APP.name)} <span style="color:${B.muted};font-weight:500">· ${esc(APP.subtitle)}</span></span></div>
  <div style="position:absolute;left:${L.headX}px;top:104px;font-size:26px;letter-spacing:.16em;text-transform:uppercase;color:${B.accentLight};font-weight:700">Chapter ${n} of ${total} &nbsp;·&nbsp; <span style="color:#e2e8f0">${title}</span></div>
  <div style="position:absolute;left:${L.headX}px;bottom:62px;display:flex;gap:10px;align-items:center">${pills}</div>
  <div style="position:absolute;right:70px;bottom:52px;font-size:26px;color:${B.muted};letter-spacing:.04em">${esc(APP.url.replace(/^https?:\/\//, ''))}</div></body>`
}

const bezelHtml = () => {
  const b = L.bezel
  return `<body style="margin:0;width:1920px;height:1080px;background:transparent;overflow:hidden">
  <div style="position:absolute;left:${SCREEN.x - b}px;top:${SCREEN.y - b}px;width:${SCREEN.w}px;height:${SCREEN.h}px;border:${b}px solid #0a0f1c;border-radius:${L.radius + L.bezel}px;box-shadow:0 0 0 2px #334155,0 40px 90px rgba(0,0,0,.6),0 0 120px ${rgba(B.accent,.18)}"></div></body>`
}

const introHtml = () => `<body style="margin:0;width:1920px;height:1080px;overflow:hidden;background:#${NAVY};font-family:${FONT};color:#fff">
  <div id="glow" style="position:absolute;left:50%;top:44%;width:1500px;height:1500px;margin:-750px 0 0 -750px;background:radial-gradient(closest-side,${rgba(B.accent,.6)},${rgba(B.accent,0)});opacity:0"></div>
  <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
    <div id="badge" style="width:200px;height:200px;border-radius:56px;background:${B.accent};display:flex;align-items:center;justify-content:center;font-size:116px;box-shadow:0 0 0 20px rgba(254,202,202,.15),0 30px 80px rgba(0,0,0,.5);opacity:0">${esc(APP.icon)}</div>
    <div id="title" style="margin-top:50px;font-size:140px;font-weight:700;letter-spacing:-3px;opacity:0">${esc(APP.name)}</div>
    <div id="sub" style="margin-top:4px;font-size:56px;font-weight:600;color:${B.accentLight};opacity:0">${esc(APP.subtitle)}</div>
    <div style="margin-top:58px;display:flex;gap:20px">${chipsHtml(cfg.introChips)}</div>
  </div>
  <div id="foot" style="position:absolute;left:0;right:0;bottom:60px;text-align:center;font-size:30px;color:${B.muted};letter-spacing:.16em;text-transform:uppercase;opacity:0">${esc(APP.org)}</div>
  <div id="fade" style="position:absolute;inset:0;background:#${NAVY};opacity:0"></div>
  <style>.chip{padding:14px 30px;border-radius:999px;background:rgba(255,255,255,.08);border:2px solid rgba(255,255,255,.16);font-size:34px;font-weight:600}</style>
  <script>
    const c=(x)=>Math.min(1,Math.max(0,x)), seg=(t,a,b)=>c((t-a)/(b-a)), out=(x)=>1-Math.pow(1-x,3)
    const back=(x)=>{const s=1.70158;x-=1;return x*x*((s+1)*x+s)+1}
    const $=(s)=>{const e=document.querySelector(s);if(!e)throw new Error('missing '+s);return e}, chips=[...document.querySelectorAll('.chip')]
    window.render=(t)=>{
      $('#glow').style.opacity=out(seg(t,0,1.4))*0.95
      const b=seg(t,0.35,1.15);$('#badge').style.opacity=c(b*3);$('#badge').style.transform='scale('+(0.6+0.4*back(b))+')'
      const a=out(seg(t,1.0,1.7));$('#title').style.opacity=a;$('#title').style.transform='translateY('+(28*(1-a))+'px)'
      const s=out(seg(t,1.5,2.2));$('#sub').style.opacity=s;$('#sub').style.transform='translateY('+(22*(1-s))+'px)'
      chips.forEach((el,i)=>{const k=out(seg(t,2.3+i*0.28,2.9+i*0.28));el.style.opacity=k;el.style.transform='translateY('+(20*(1-k))+'px)'})
      $('#foot').style.opacity=out(seg(t,3.2,4.0))
      $('#fade').style.opacity=seg(t,6.9,7.5)
    }
  </script></body>`

const outroHtml = (qrSvg) => `<body style="margin:0;width:1920px;height:1080px;overflow:hidden;background:#${NAVY};font-family:${FONT};color:#fff">
  <div id="glow" style="position:absolute;left:30%;top:50%;width:1500px;height:1500px;margin:-750px 0 0 -750px;background:radial-gradient(closest-side,${rgba(B.accent,.5)},${rgba(B.accent,0)});opacity:0"></div>
  <div style="position:absolute;left:150px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;width:1000px">
    <div id="a" style="font-size:108px;font-weight:700;letter-spacing:-2px;opacity:0">${esc(cfg.outroTitle ?? `That's ${APP.name}.`)}</div>
    <div id="chips" style="margin-top:36px;display:flex;gap:16px">
      ${chipsHtml(cfg.outroChips)}</div>
    <div id="url" style="margin-top:64px;font-size:84px;font-weight:700;color:${B.accentLight};opacity:0">${esc(APP.url.replace(/^https?:\/\//, ''))}</div>
    <div id="help" style="margin-top:26px;font-size:44px;font-weight:500;color:#e2e8f0;opacity:0;line-height:1.3">${esc(cfg.outroHelp)}</div>
  </div>
  <div id="qr" style="position:absolute;right:190px;top:50%;margin-top:-210px;width:420px;height:420px;border-radius:36px;background:#fff;padding:26px;box-sizing:border-box;box-shadow:0 30px 80px rgba(0,0,0,.5);opacity:0">${qrSvg}
    <div style="position:absolute;left:0;right:0;bottom:-62px;text-align:center;font-size:28px;color:${B.muted}">${esc(cfg.qrLabel)}</div></div>
  <div id="foot" style="position:absolute;left:0;right:0;bottom:52px;text-align:center;font-size:26px;color:#64748b;letter-spacing:.12em;text-transform:uppercase;opacity:0">${esc(APP.org)}</div>
  <div id="fade" style="position:absolute;inset:0;background:#000;opacity:1"></div>
  <style>.chip{padding:12px 26px;border-radius:999px;background:rgba(255,255,255,.08);border:2px solid rgba(255,255,255,.16);font-size:32px;font-weight:600}svg{width:100%;height:100%}</style>
  <script>
    const c=(x)=>Math.min(1,Math.max(0,x)), seg=(t,a,b)=>c((t-a)/(b-a)), out=(x)=>1-Math.pow(1-x,3)
    const $=(s)=>{const e=document.querySelector(s);if(!e)throw new Error('missing '+s);return e}, chips=[...document.querySelectorAll('.chip')]
    window.render=(t)=>{
      $('#glow').style.opacity=out(seg(t,0,1.2))
      const a=out(seg(t,0.3,1.0));$('#a').style.opacity=a;$('#a').style.transform='translateY('+(26*(1-a))+'px)'
      chips.forEach((el,i)=>{const k=out(seg(t,1.0+i*0.25,1.6+i*0.25));el.style.opacity=k;el.style.transform='translateY('+(18*(1-k))+'px)'})
      const u=out(seg(t,2.0,2.7));$('#url').style.opacity=u;$('#url').style.transform='translateY('+(24*(1-u))+'px)'
      const q=out(seg(t,2.2,3.0));$('#qr').style.opacity=q;$('#qr').style.transform='scale('+(0.92+0.08*q)+')'
      $('#help').style.opacity=out(seg(t,3.2,3.9))
      $('#foot').style.opacity=out(seg(t,4.2,5.0))
      $('#fade').style.opacity=Math.max(1-out(seg(t,0,0.6)), seg(t,8.2,9.0))
    }
  </script></body>`

async function renderAssets() {
  const { chromium } = await import('playwright')
  const tl = timeline()
  mkdirSync(compose, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })

  for (const [i, s] of tl.scenes.entries()) {
    await page.setContent(bgHtml(i + 1, tl.scenes.length, s.title))
    await page.screenshot({ path: join(compose, `bg-${i + 1}.png`) })
  }
  // Rounded-corner mask for the recorded screen: without it the square corners of the app poke out past the frame.
  await page.setViewportSize({ width: SCREEN.w, height: SCREEN.h })
  await page.setContent(`<body style="margin:0;background:#000"><div style="width:${SCREEN.w}px;height:${SCREEN.h}px;background:#fff;border-radius:${L.radius}px"></div></body>`)
  await page.screenshot({ path: join(compose, 'mask.png') })
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.setContent(bezelHtml())
  await page.screenshot({ path: join(compose, 'bezel.png'), omitBackground: true })

  // QR code to the app, for the outro
  const QR = createRequire(import.meta.url)('qrcode')
  const qrSvg = await QR.toString(APP.url || 'https://example.com', { type: 'svg', margin: 0, color: { dark: `#${NAVY}`, light: '#ffffff' } })

  for (const [name, html, seconds] of [['intro', introHtml(), tl.titleCard], ['outro', outroHtml(qrSvg), tl.endCard]]) {
    const dir = join(compose, `${name}-frames`)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    // A fresh page each time: both animations declare the same top-level names, and reusing a page makes the second script fail.
    const anim = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
    await anim.setContent(html)
    const n = Math.round(seconds * FPS)
    for (let f = 0; f < n; f++) {
      await anim.evaluate((t) => window.render(t), f / FPS)
      await anim.screenshot({ path: join(dir, `${String(f).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 94 })
    }
    await anim.close()
    ffmpeg(['-framerate', String(FPS), '-i', join(dir, '%04d.jpg'), '-c:v', 'libx264', '-crf', '15', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', String(FPS), join(compose, `${name}.mp4`)])
  }
  await browser.close()
  // fonts for the burned-in captions (libass reads them from a folder)
  mkdirSync(join(compose, 'fonts'), { recursive: true })
  for (const f of cfg.fonts.files) {
    const src = join(cfg.fonts.dir, f)
    if (existsSync(src)) copyFileSync(src, join(compose, 'fonts', f))
  }
}

// ---- captions (ASS) -----------------------------------------------------------------------------
function assTime(sec) {
  const cs = Math.round(sec * 100)
  return `${Math.floor(cs / 360000)}:${pad2(Math.floor((cs % 360000) / 6000))}:${pad2(Math.floor((cs % 6000) / 100))}.${pad2(cs % 100)}`
}
const assEscape = (t) => t.replace(/\\/g, '').replace(/[{}]/g, '').replace(/\n/g, ' ')

function captionsAss(i) {
  const tl = timeline()
  const s = tl.scenes[i]
  const cues = tl.cues.filter((c) => c.scene === s.id)
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,${cfg.fonts.caption},${L.capSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H78000000,0,0,0,0,100,100,0,0,1,0,3,4,${CAP_X},${L.capMarginR},0,1
Style: Eyebrow,${cfg.fonts.ui},${L.eyebrowSize},${assColor(B.accentLight)},${assColor(B.accentLight)},&H00000000,&H00000000,-1,0,0,0,100,100,6,0,1,0,0,4,${CAP_X},${L.capMarginR},0,1
Style: Title,${cfg.fonts.ui},${L.titleSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H78000000,-1,0,0,0,100,100,0,0,1,0,4,4,${CAP_X},100,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`
  const lines = []
  const lead = Math.max(1.2, cues[0].start - s.start - 0.1)
  // The title hangs from a fixed top line and the eyebrow sits on a baseline above it, so a title that wraps onto two or
  // three lines grows downwards instead of into the eyebrow.
  const titleTop = 470
  lines.push(`Dialogue: 0,${assTime(0.1)},${assTime(lead)},Eyebrow,,0,0,0,,{\\an1\\pos(${CAP_X},${titleTop - 22})\\fad(300,400)}CHAPTER ${i + 1} OF ${tl.scenes.length}`)
  lines.push(`Dialogue: 0,${assTime(0.1)},${assTime(lead)},Title,,0,0,0,,{\\an7\\pos(${CAP_X},${titleTop})\\fad(300,400)}${assEscape(s.title)}`)
  for (const c of cues) {
    lines.push(`Dialogue: 0,${assTime(c.start - s.start)},${assTime(c.end - s.start)},Cap,,0,0,0,,{\\fad(140,160)}${assEscape(c.text)}`)
  }
  return head + lines.join('\n') + '\n'
}

// ---- compose ------------------------------------------------------------------------------------
function loudnorm() {
  return 'loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000'
}

function composeScene(i) {
  const tl = timeline()
  const s = tl.scenes[i]
  const dur = s.end - s.start
  writeFileSync(join(compose, `captions-${i + 1}.ass`), captionsAss(i))
  ffmpeg(
    [
      '-loop', '1', '-framerate', String(FPS), '-t', dur.toFixed(3), '-i', `bg-${i + 1}.png`,
      '-i', join('..', s.id, 'raw.mp4'), '-i', 'bezel.png', '-i', 'mask.png',
      '-filter_complex',
      `[1:v]scale=${SCREEN.w}:${SCREEN.h}:flags=lanczos,format=yuva420p[sc];[3:v]scale=${SCREEN.w}:${SCREEN.h},format=gray[mk];[sc][mk]alphamerge[ph];[0:v][ph]overlay=${SCREEN.x}:${SCREEN.y}:format=auto[a];[a][2:v]overlay=0:0[b];` +
        `[b]subtitles=captions-${i + 1}.ass:fontsdir=fonts,fade=t=in:st=0:d=0.4:color=0x${NAVY},fade=t=out:st=${(dur - 0.4).toFixed(3)}:d=0.4:color=0x${NAVY},format=yuv420p[v]`,
      '-map', '[v]', '-t', dur.toFixed(3), '-r', String(FPS), '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', `scene-${i + 1}.mp4`,
    ],
    { cwd: compose },
  )
}

function composeAll() {
  const tl = timeline()
  mkdirSync(out, { recursive: true })
  mkdirSync(join(out, 'chapters'), { recursive: true })
  const dur = (s) => s.end - s.start

  for (const [i, s] of tl.scenes.entries()) {
    if (!existsSync(join(work, s.id, 'frames.json'))) throw new Error(`scene ${s.id} has not been recorded`)
    buildClip(s.id)
    composeScene(i)
    // chapter = scene + its own narration track
    const name = `${pad2(i + 1)}-${s.id}.mp4`
    ffmpeg(
      [
        '-i', `scene-${i + 1}.mp4`, '-i', join(audioDir, 'chapters', `${pad2(i + 1)}-${s.id}.wav`),
        '-filter_complex', `[1:a]afade=t=in:st=0:d=0.3,afade=t=out:st=${(dur(s) - 0.5).toFixed(3)}:d=0.5,${loudnorm()}[a]`,
        '-map', '0:v', '-map', '[a]', '-t', dur(s).toFixed(3), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', join(out, 'chapters', name),
      ],
      { cwd: compose },
    )
    console.log('chapter', name)
  }

  // the film: intro, scenes with a short dip between them, outro
  ffmpeg(['-f', 'lavfi', '-i', `color=c=0x${NAVY}:s=1920x1080:r=${FPS}`, '-t', String(tl.scenes.length > 1 ? 1.2 : 0), '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', join(compose, 'gap.mp4')])
  const list = ['intro.mp4']
  tl.scenes.forEach((_, i) => {
    list.push(`scene-${i + 1}.mp4`)
    if (i < tl.scenes.length - 1) list.push('gap.mp4')
  })
  list.push('outro.mp4')
  writeFileSync(join(compose, 'film.txt'), list.map((f) => `file '${f}'`).join('\n') + '\n')
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', 'film.txt', '-c', 'copy', 'film-video.mp4'], { cwd: compose })
  const probed = Number(spawnSync(ffprobePath(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(compose, 'film-video.mp4')], { encoding: 'utf8' }).stdout)
  if (Math.abs(probed - tl.filmEnd) > 0.25) {
    console.log(`stream copy gave ${probed.toFixed(2)}s, expected ${tl.filmEnd.toFixed(2)}s; re-encoding the join`)
    ffmpeg(['-f', 'concat', '-safe', '0', '-i', 'film.txt', '-c:v', 'libx264', '-crf', '15', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', String(FPS), 'film-video.mp4'], { cwd: compose })
  }
  const master = join(audioDir, `${cfg.slug}.narration.wav`)
  const music = cfg.music?.file ? resolve(videoDir, cfg.music.file) : ''
  if (cfg.music?.file && !existsSync(music)) throw new Error(`music.file not found: ${music} (make one with: tapreel music)`)
  // Music sits under the voice and swells in the intro and outro: it is ducked by the narration, never the other way round.
  const mixGraph = music
    ? `[1:a]asplit=2[n1][n2];[2:a]aloop=loop=-1:size=2000000000,atrim=0:${tl.filmEnd.toFixed(3)},asetpts=PTS-STARTPTS,volume=${cfg.music.volumeDb}dB,afade=t=in:d=${cfg.music.fadeIn},afade=t=out:st=${(tl.filmEnd - cfg.music.fadeOut).toFixed(3)}:d=${cfg.music.fadeOut}[m];` +
      (cfg.music.duck ? `[m][n2]sidechaincompress=threshold=0.02:ratio=10:attack=20:release=600:makeup=1[md];` : `[n2]anullsink;[m]acopy[md];`) +
      `[n1][md]amix=inputs=2:normalize=0:duration=first,afade=t=out:st=${(tl.filmEnd - 1.2).toFixed(3)}:d=1.2,${loudnorm()}[a]`
    : `[1:a]afade=t=out:st=${(tl.filmEnd - 1.2).toFixed(3)}:d=1.2,${loudnorm()}[a]`
  ffmpeg(
    [
      '-i', 'film-video.mp4', '-i', master, ...(music ? ['-i', music] : []),
      '-filter_complex', mixGraph,
      '-map', '0:v', '-map', '[a]', '-t', tl.filmEnd.toFixed(3), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', join(out, `${cfg.slug}.mp4`),
    ],
    { cwd: compose },
  )
  copyFileSync(join(videoDir, `${cfg.slug}.srt`), join(out, `${cfg.slug}.srt`))
  ffmpeg(['-ss', '3.2', '-i', join(compose, 'intro.mp4'), '-frames:v', '1', join(out, 'poster.png')])
  console.log('film', join(out, `${cfg.slug}.mp4`))
}

// ---- CLI ----------------------------------------------------------------------------------------
const [cmd, arg] = process.argv.slice(2)
if (process.argv[1]?.endsWith('build-video.mjs')) {
  if (cmd === 'clips') {
    for (const id of readdirSync(work).filter((d) => existsSync(join(work, d, 'frames.json')))) console.log('clip', id, buildClip(id))
  } else if (cmd === 'sheet') {
    console.log(contactSheet(arg))
  } else if (cmd === 'assets') {
    await renderAssets()
  } else if (cmd === 'compose') {
    composeAll()
  } else {
    await renderAssets()
    composeAll()
  }
}
