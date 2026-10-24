export default async function ({ page, S, ui }) {
  await S.at(S.cue('Got a new plant') + 0.3)
  await ui.safe('ring add', () => ui.ring(page, page.locator('#add'), 'Add plant', 1000, 1))
  await S.at(S.cue('Got a new plant') + 1.6)
  await ui.safe('tap add', () => ui.tap(page.locator('#add')))
  await S.at(S.cue('Give it a name') + 0.2)
  await ui.safe('type name', () => ui.typeSlowly(page.locator('#n'), 'Basil', 110))
  await S.at(S.cue('Give it a name') + 2.6)
  await ui.safe('tap save', () => ui.tap(page.locator('#save')))
  await S.at(S.cue('That') + 0.2)
  await ui.safe('ring toast', () => ui.ring(page, page.locator('.toast'), 'Added', 2400))
}
