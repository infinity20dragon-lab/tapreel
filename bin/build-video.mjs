// Turns the recorder's frames (tests/e2e/crew-video.spec.ts -> video-work/<scene>/) into the finished film.
//
//   node scripts/build-video.mjs clips            frames -> video-work/<scene>/raw.mp4 (30 fps, real timing)
//   node scripts/build-video.mjs sheet <scene>    contact sheet PNG of a scene, for a quick look
//   node scripts/build-video.mjs assets           backgrounds, phone frame, animated intro and outro
//   node scripts/build-video.mjs compose          each chapter and the full film
//   node scripts/build-video.mjs                  all of the above
//
// Layout (1920x1080): the phone on the left in a device frame, the narration as large captions on the right, a chapter
// label and progress at the top. Captions are burned in from the same timeline as the narration audio.
// Output: docs/video/out/ (git-ignored).
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { ffmpeg, ffprobePath } from './lib/ffmpeg.mjs'
import { root, videoDir, audioDir } from './lib/video-script.mjs'

export const work = resolve(root, 'video-work')
const compose = join(work, 'compose')
const out = join(videoDir, 'out')
const FPS = 30
const NAVY = '0b1220'
const SCREEN = { x: 230, y: 70, w: 434, h: 940 } // where the phone screen sits on the 1920x1080 canvas
const CAP_X = 820 // left edge of the caption column
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
    '-vf', `fps=${FPS},scale=780:1688:flags=lanczos,format=yuv420p`,
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
const FONT = `'Segoe UI', system-ui, sans-serif`

function bgHtml(n, total, title) {
  const pills = Array.from({ length: total }, (_, i) => `<span style="width:${i + 1 === n ? 64 : 28}px;height:10px;border-radius:5px;background:${i + 1 === n ? '#f87171' : 'rgba(148,163,184,.35)'}"></span>`).join('')
  return `<body style="margin:0;width:1920px;height:1080px;overflow:hidden;font-family:${FONT};color:#fff;background:#${NAVY}">
  <div style="position:absolute;inset:0;background:radial-gradient(900px 900px at 450px 540px,rgba(153,27,27,.42),rgba(153,27,27,0) 70%),linear-gradient(135deg,#0b1220,#101a30 60%,#0b1220)"></div>
  <div style="position:absolute;left:0;top:0;bottom:0;width:10px;background:#991b1b"></div>
  <div style="position:absolute;left:${CAP_X}px;top:30px;display:flex;align-items:center;gap:14px;font-size:30px;font-weight:700">
    <span style="width:46px;height:46px;border-radius:14px;background:#991b1b;display:inline-flex;align-items:center;justify-content:center;font-size:26px">🚒</span>
    <span>HydrantCheck <span style="color:#94a3b8;font-weight:500">· Station Crew Guide</span></span></div>
  <div style="position:absolute;left:${CAP_X}px;top:104px;font-size:26px;letter-spacing:.16em;text-transform:uppercase;color:#fca5a5;font-weight:700">Chapter ${n} of ${total} &nbsp;·&nbsp; <span style="color:#e2e8f0">${title}</span></div>
  <div style="position:absolute;left:${CAP_X}px;bottom:62px;display:flex;gap:10px;align-items:center">${pills}</div>
  <div style="position:absolute;right:70px;bottom:52px;font-size:26px;color:#94a3b8;letter-spacing:.04em">hydrants.ismfd.com</div></body>`
}

const bezelHtml = () => {
  const b = 14
  return `<body style="margin:0;width:1920px;height:1080px;background:transparent;overflow:hidden">
  <div style="position:absolute;left:${SCREEN.x - b}px;top:${SCREEN.y - b}px;width:${SCREEN.w}px;height:${SCREEN.h}px;border:${b}px solid #0a0f1c;border-radius:62px;box-shadow:0 0 0 2px #334155,0 40px 90px rgba(0,0,0,.6),0 0 120px rgba(153,27,27,.18)"></div></body>`
}

const introHtml = () => `<body style="margin:0;width:1920px;height:1080px;overflow:hidden;background:#${NAVY};font-family:${FONT};color:#fff">
  <div id="glow" style="position:absolute;left:50%;top:44%;width:1500px;height:1500px;margin:-750px 0 0 -750px;background:radial-gradient(closest-side,rgba(153,27,27,.6),rgba(153,27,27,0));opacity:0"></div>
  <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
    <div id="badge" style="width:200px;height:200px;border-radius:56px;background:#991b1b;display:flex;align-items:center;justify-content:center;font-size:116px;box-shadow:0 0 0 20px rgba(254,202,202,.15),0 30px 80px rgba(0,0,0,.5);opacity:0">🚒</div>
    <div id="title" style="margin-top:50px;font-size:140px;font-weight:700;letter-spacing:-3px;opacity:0">HydrantCheck</div>
    <div id="sub" style="margin-top:4px;font-size:56px;font-weight:600;color:#fca5a5;opacity:0">Station Crew Guide</div>
    <div style="margin-top:58px;display:flex;gap:20px">
      <span class="chip" style="opacity:0">Inspect hydrants</span><span class="chip" style="opacity:0">Fix addresses</span><span class="chip" style="opacity:0">Works with no signal</span></div>
  </div>
  <div id="foot" style="position:absolute;left:0;right:0;bottom:60px;text-align:center;font-size:30px;color:#94a3b8;letter-spacing:.16em;text-transform:uppercase;opacity:0">Southern Marin Fire Protection District</div>
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
  <div id="glow" style="position:absolute;left:30%;top:50%;width:1500px;height:1500px;margin:-750px 0 0 -750px;background:radial-gradient(closest-side,rgba(153,27,27,.5),rgba(153,27,27,0));opacity:0"></div>
  <div style="position:absolute;left:150px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;width:1000px">
    <div id="a" style="font-size:108px;font-weight:700;letter-spacing:-2px;opacity:0">That's HydrantCheck.</div>
    <div id="chips" style="margin-top:36px;display:flex;gap:16px">
      <span class="chip" style="opacity:0">Inspect</span><span class="chip" style="opacity:0">Fix addresses</span><span class="chip" style="opacity:0">Offline mode</span></div>
    <div id="url" style="margin-top:64px;font-size:84px;font-weight:700;color:#fca5a5;opacity:0">hydrants.ismfd.com</div>
    <div id="help" style="margin-top:26px;font-size:44px;font-weight:500;color:#e2e8f0;opacity:0;line-height:1.3">Stuck? Ask your station officer or Prevention.</div>
  </div>
  <div id="qr" style="position:absolute;right:190px;top:50%;margin-top:-210px;width:420px;height:420px;border-radius:36px;background:#fff;padding:26px;box-sizing:border-box;box-shadow:0 30px 80px rgba(0,0,0,.5);opacity:0">${qrSvg}
    <div style="position:absolute;left:0;right:0;bottom:-62px;text-align:center;font-size:28px;color:#94a3b8">Scan to open</div></div>
  <div id="foot" style="position:absolute;left:0;right:0;bottom:52px;text-align:center;font-size:26px;color:#64748b;letter-spacing:.12em;text-transform:uppercase;opacity:0">Southern Marin Fire Protection District</div>
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
  const { chromium } = await import('@playwright/test')
  const tl = timeline()
  mkdirSync(compose, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })

  for (const [i, s] of tl.scenes.entries()) {
    await page.setContent(bgHtml(i + 1, tl.scenes.length, s.title))
    await page.screenshot({ path: join(compose, `bg-${i + 1}.png`) })
  }
  await page.setContent(bezelHtml())
  await page.screenshot({ path: join(compose, 'bezel.png'), omitBackground: true })

  // QR code to the app, for the outro
  const wrk = createRequire(join(work, 'x.js'))
  const QR = wrk('qrcode')
  const qrSvg = await QR.toString('https://hydrants.ismfd.com', { type: 'svg', margin: 0, color: { dark: `#${NAVY}`, light: '#ffffff' } })

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
  for (const f of ['segoeui.ttf', 'segoeuib.ttf', 'seguisb.ttf']) {
    const src = join('C:/Windows/Fonts', f)
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
Style: Cap,Segoe UI Semibold,68,&H00FFFFFF,&H00FFFFFF,&H00000000,&H78000000,0,0,0,0,100,100,0,0,1,0,3,4,${CAP_X},150,0,1
Style: Eyebrow,Segoe UI,34,&H00A5A5FC,&H00A5A5FC,&H00000000,&H00000000,-1,0,0,0,100,100,6,0,1,0,0,4,${CAP_X},100,0,1
Style: Title,Segoe UI,112,&H00FFFFFF,&H00FFFFFF,&H00000000,&H78000000,-1,0,0,0,100,100,0,0,1,0,4,4,${CAP_X},100,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`
  const lines = []
  const lead = Math.max(1.2, cues[0].start - s.start - 0.1)
  lines.push(`Dialogue: 0,${assTime(0.1)},${assTime(lead)},Eyebrow,,0,0,0,,{\\an4\\pos(${CAP_X},430)\\fad(300,400)}CHAPTER ${i + 1} OF ${tl.scenes.length}`)
  lines.push(`Dialogue: 0,${assTime(0.1)},${assTime(lead)},Title,,0,0,0,,{\\an4\\pos(${CAP_X},540)\\fad(300,400)}${assEscape(s.title)}`)
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
      '-i', join('..', s.id, 'raw.mp4'), '-i', 'bezel.png',
      '-filter_complex',
      `[1:v]scale=${SCREEN.w}:${SCREEN.h}:flags=lanczos[ph];[0:v][ph]overlay=${SCREEN.x}:${SCREEN.y}[a];[a][2:v]overlay=0:0[b];` +
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
  const master = join(audioDir, 'crew-how-to.narration.wav')
  ffmpeg(
    [
      '-i', 'film-video.mp4', '-i', master,
      '-filter_complex', `[1:a]afade=t=out:st=${(tl.filmEnd - 1.2).toFixed(3)}:d=1.2,${loudnorm()}[a]`,
      '-map', '0:v', '-map', '[a]', '-t', tl.filmEnd.toFixed(3), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', join(out, 'HydrantCheck-Crew-How-To.mp4'),
    ],
    { cwd: compose },
  )
  copyFileSync(join(videoDir, 'crew-how-to.srt'), join(out, 'HydrantCheck-Crew-How-To.srt'))
  ffmpeg(['-ss', '3.2', '-i', join(compose, 'intro.mp4'), '-frames:v', '1', join(out, 'poster.png')])
  console.log('film', join(out, 'HydrantCheck-Crew-How-To.mp4'))
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
