export default async function ({ page, S, ui }) {
  await S.at(S.cue('Phone order') + 0.3)
  await ui.safe('ring new', () => ui.ring(page, page.locator('#newo'), 'New order', 1000, 1))
  await S.at(S.cue('Phone order') + 1.5)
  await ui.safe('tap new', () => ui.tap(page.locator('#newo')))
  await S.at(S.cue('Type the') + 0.3)
  await ui.safe('type', () => ui.typeSlowly(page.locator('#who'), 'Lakeside Deli', 90))
  await S.at(S.cue('Type the') + 3.4)
  await ui.safe('create', () => ui.tap(page.locator('#create')))
  await S.at(S.cue('It lands') + 0.3)
  await ui.safe('ring row', () => ui.ring(page, page.locator('tr.row').first(), 'New at the top', 2400))
}
