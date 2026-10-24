export default async function ({ page, S, ui }) {
  await S.at(S.cue('This is your orders board') + 0.3)
  await ui.safe('ring title', () => ui.ring(page, page.locator('main h2'), 'Orders', 2200))
  await S.at(S.cue('The counters') + 0.2)
  await ui.safe('ring stats', () => ui.ring(page, page.locator('.stats'), 'Counters', 2600, 1))
  await S.at(S.cue('New orders') + 0.2)
  await ui.safe('ring pill', () => ui.ring(page, page.locator('.pill.new').first(), 'New', 2600, 2))
}
