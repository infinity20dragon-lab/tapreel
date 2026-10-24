export default async function ({ page, S, ui }) {
  await S.at(S.cue('This is your garden') + 0.3)
  await ui.safe('ring header', () => ui.ring(page, page.locator('header h1'), 'Your garden', 2200))
  await S.at(S.cue('The yellow badges') + 0.2)
  await ui.safe('ring fern badge', () => ui.ring(page, page.locator('.card').nth(0).locator('.badge'), 'Thirsty', 2200, 1))
  await S.at(S.cue('Right now') + 1.0)
  await ui.safe('ring monstera badge', () => ui.ring(page, page.locator('.card').nth(2).locator('.badge'), 'Thirsty', 2200, 2))
}
