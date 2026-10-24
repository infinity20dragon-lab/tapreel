// Makes a royalty-free background track from scratch (no samples, nothing downloaded): a soft chord pad with a gentle
// pluck pattern. It belongs to whoever runs this. Use `tapreel music --style calm|bright|warm --minutes 3`.
// For anything fancier use your own track (one you have the rights to) and set music.file in the config.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ffmpeg } from './lib/ffmpeg.mjs'
import { videoDir } from './lib/config.mjs'

const note = (n) => 440 * 2 ** ((n - 69) / 12) // midi -> Hz
const STYLES = {
  calm: { bpm: 72, chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], pluck: 12 }, // Am F C G
  bright: { bpm: 96, chords: [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]], pluck: 12 }, // C G Am F
  warm: { bpm: 66, chords: [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]], pluck: 0 }, // Dm Bb F C
}

const style = process.argv.includes('--style') ? process.argv[process.argv.indexOf('--style') + 1] : 'calm'
const minutes = Number(process.argv.includes('--minutes') ? process.argv[process.argv.indexOf('--minutes') + 1] : 3)
const S = STYLES[style]
if (!S) throw new Error(`style must be one of: ${Object.keys(STYLES).join(', ')}`)

const beat = 60 / S.bpm
const barLen = beat * 4
const bars = Math.max(4, Math.round((minutes * 60) / barLen / 4) * 4)
const SR = 44100
const total = bars * barLen
const n = Math.round(total * SR)
const buf = new Float32Array(n)

for (let b = 0; b < bars; b++) {
  const chord = S.chords[b % S.chords.length]
  const t0 = b * barLen
  // pad: each note a soft sine pair, swelling in and out across the bar so chords overlap smoothly
  for (const m of chord) {
    const f = note(m)
    for (let i = 0; i < Math.round((barLen + beat) * SR); i++) {
      const idx = Math.round(t0 * SR) + i
      if (idx >= n) break
      const t = i / SR
      const env = Math.min(1, t / (beat * 1.5)) * Math.min(1, (barLen + beat - t) / (beat * 1.5))
      buf[idx] += 0.07 * env * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(2 * Math.PI * f * 2.003 * t))
    }
  }
  // pluck: a quiet arpeggio, eight notes a bar, each with a fast decay
  if (S.pluck) {
    for (let k = 0; k < 8; k++) {
      const m = chord[k % 3] + (k % 4 === 3 ? 12 : 12)
      const f = note(m)
      const start = Math.round((t0 + k * beat * 0.5) * SR)
      for (let i = 0; i < Math.round(beat * 1.2 * SR); i++) {
        if (start + i >= n) break
        const t = i / SR
        buf[start + i] += 0.05 * Math.exp(-5.5 * t) * Math.sin(2 * Math.PI * f * t) * Math.min(1, t / 0.004)
      }
    }
  }
}

// 16-bit mono WAV, then ffmpeg adds air (echo), softens the highs and makes the loop seamless-ish with a fade at each end.
let peak = 0
for (const v of buf) peak = Math.max(peak, Math.abs(v))
const gain = 0.8 / (peak || 1)
const pcm = Buffer.alloc(44 + n * 2)
pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + n * 2, 4); pcm.write('WAVEfmt ', 8); pcm.writeUInt32LE(16, 16)
pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(SR, 24); pcm.writeUInt32LE(SR * 2, 28)
pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(n * 2, 40)
for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(buf[i] * gain * 32767))), 44 + i * 2)
mkdirSync(videoDir, { recursive: true })
const raw = join(videoDir, '.music-raw.wav')
writeFileSync(raw, pcm)
const out = join(videoDir, `music-${style}.wav`)
ffmpeg(['-i', raw, '-af', `lowpass=f=2600,aecho=0.8:0.6:380|700:0.35|0.22,afade=t=in:d=1.5,afade=t=out:st=${(total - 2).toFixed(2)}:d=2,aformat=channel_layouts=stereo,aresample=48000`, out])
import('node:fs').then((fs) => fs.rmSync(raw))
console.log(`wrote ${out} (${(total / 60).toFixed(1)} min, ${style}). Set "music": { "file": "music-${style}.wav" } in tapreel.config.json.`)
