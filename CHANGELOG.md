# Changelog

What changed in each version of Tapreel, newest first.

## 0.1.1 (2026-10-30)

### Fixed
- **In-breath before the first word.** The voice engine often takes a slow, quiet breath (0.1-0.6 s) before a phrase, and loudness normalisation made it audible at the start of many lines. The mix now silences it with a short fade. The samples are zeroed, never removed, so every phrase keeps its length and the footage stays in sync. Real word onsets, such as the "S" in "Staff", are left alone. Existing takes are fixed by `tapreel narrate --mix-only`; nothing needs re-rendering.
- **Chapter titles running into "Chapter n of N".** A title that wrapped onto several lines grew upwards into the chapter number. The title and chapter number are now placed as one block, so long titles grow evenly.
- **Loose spacing in wrapped chapter titles.** Wrapped lines were spaced by the font's full line box. Tapreel now wraps titles itself and sets them at a heading's line height.

### Changed
- Chapter titles are measured with the caption font's own letter widths (read from the font file, new `bin/lib/font-metrics.mjs`) and split so the lines are about even: "A meeting, / in public", not "A meeting, in / public".
- Desktop chapter titles are a little smaller (64 px, was 84 px), so most titles fit on two lines beside the screen.

### Docs
- README: new "Chapter cards" section; the audio rules mention the silenced in-breath.
- `skills/tapreel-qa`: rule 3 covers the in-breath and how it is handled.

## 0.1.0 (2026-10-25)

First release.

- Narrated how-to videos of any web app: Playwright drives and records the real app, a local VoiceStudio voice narrates every step, and ffmpeg composes the film with chapters, captions, an intro and an outro with a QR code.
- Config-driven films, a CLI (`init`, `doctor`, `consent`, `plan`, `narrate`, `record`, `build`, `check`), scene and script templates, and the `tapreel-setup`, `tapreel-make` and `tapreel-qa` skills.
- Safety: demo accounts only, credentials from environment variables, an allow-list of sites (with wildcard subdomains and a report of blocked hosts), and owner consent before recording.
- Phone layout with a rounded device frame, and a desktop-window layout.
- Voice choice (presets, designed voices, auditions) and royalty-free background music that ducks under the narration.
- Sample films: Pocket Plants (phone) and Brewline (desktop).
