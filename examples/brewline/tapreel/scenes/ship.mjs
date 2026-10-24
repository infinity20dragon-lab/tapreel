export default async function ({ page, S, ui }) {
  await S.at(S.cue('Click any order') + 0.5)
  await ui.safe('open order', () => ui.tap(page.locator('tr.row').first()))
  await S.at(S.cue('Then click Mark shipped') + 0.3)
  await ui.safe('ring ship', () => ui.ring(page, page.locator('#ship'), 'Mark shipped', 1000, 1))
  await S.at(S.cue('Then click Mark shipped') + 1.6)
  await ui.safe('ship', () => ui.tap(page.locator('#ship')))
  await S.at(S.cue('The customer') + 0.3)
  await ui.safe('ring toast', () => ui.ring(page, page.locator('.toast'), 'Notified', 2400))
}
