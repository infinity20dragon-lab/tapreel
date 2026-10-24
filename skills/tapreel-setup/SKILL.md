---
name: tapreel-setup
description: Check and install what Tapreel needs (VoiceStudio, ffmpeg, Playwright, and the film editor) before making a video. Use at the start of any Tapreel job, or when a Tapreel step fails because a tool is missing.
---

# Tapreel setup

Tapreel needs these tools. Check each one, and **ask the user before installing anything**.
If the user says no to a required tool, stop and say: "Tapreel can't run without it."

| Need | Check | Install (only after the user says yes) |
|---|---|---|
| VoiceStudio (local voice engine) | `GET http://localhost:3900/profiles` answers | Install VoiceStudio from https://github.com/debpalash/VoiceStudio, then start it |
| ffmpeg + ffprobe | `ffmpeg -version` | `winget install Gyan.FFmpeg` (Windows) / `brew install ffmpeg` |
| Playwright + Chromium | `npx playwright --version` | `npm i -D @playwright/test` then `npx playwright install chromium` |
| Film editor (FilmCraft) | `filmcraft-cli --version` | Get it from https://github.com/storytold/filmcraft |

Ask in this form: "Tapreel needs <tool> to <why>. It isn't installed. Install it now? (yes / no)".
Never install silently. Never store or print secrets.
