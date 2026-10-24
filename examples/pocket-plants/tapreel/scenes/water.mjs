export default async function ({ page, S, ui }) {
  await S.at(S.cue('Tap the fern') + 0.4)
  await ui.safe('tap fern', () => ui.tap(page.locator('.card').nth(0)))
  await S.at(S.cue('Then tap Mark watered') + 0.3)
  await ui.safe('ring water', () => ui.ring(page, page.locator('#water'), 'Mark watered', 1000, 1))
  await S.at(S.cue('Then tap Mark watered') + 1.5)
  await ui.safe('tap water', () => ui.tap(page.locator('#water')))
  await S.at(S.cue('Done') + 0.3)
  await ui.safe('ring toast', () => ui.ring(page, page.locator('.toast'), 'Reminder reset', 2400))
}
