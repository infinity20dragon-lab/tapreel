# Tapreel

**Narrated how-to videos of any web app.** Tap through the real app, add a natural-sounding voice, and ship a captioned film that looks and sounds hand-made.

Tapreel drives your app in a real browser (Playwright), records it at phone or desktop size, adds tap ripples and callouts, narrates every step with a local voice engine, and composes the finished video with chapters, captions and an intro and outro.

Status: 0.1.0, early scaffold. The scripts in `bin/` come from a real project and are being made generic.

## What you need
Tapreel asks before installing anything. If a required tool is declined, Tapreel cannot run.

| Tool | What for | Link |
|---|---|---|
| VoiceStudio | Local voice engine for the narration | https://github.com/debpalash/VoiceStudio |
| FilmCraft | Video editor (MCP) | https://github.com/storytold/filmcraft |
| ffmpeg | Encoding, loudness | https://ffmpeg.org |
| Playwright | Recording the app | https://playwright.dev |

## Install
```
/plugin marketplace add infinity20dragon-lab/tapreel
/plugin install tapreel@tapreel
```

## Rules it follows
No stretched or cut audio, breath and stray-noise rejection, a frozen timeline so re-narrating never moves the footage, transcript checks and -16 LUFS loudness. See `skills/tapreel-qa`.

## License
MIT
