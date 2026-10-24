// One file per scene, named after the scene id in script.json. The scene clock S is locked to the narration:
// S.cue('This is the home') is when that line starts being spoken.
export default async function ({ page, S, ui }) {
  await S.at(S.cue('This is the home screen') + 0.2)
  await ui.safe('ring the header', () => ui.ring(page, page.locator('h1').first(), 'Home'))
  await S.at(S.cue('Everything you need'))
  await ui.safe('scroll', () => ui.glide(page, 300, 1800))
}
