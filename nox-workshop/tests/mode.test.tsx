import { expect, test } from 'claude-code/testing'

// The engine's side, for the calls the mod makes at session start.
type TestOn = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[1]
const engine = (on: TestOn, saved?: string) => {
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'theme' } }))
  on('command.register', () => ({ value: { command: 'workshop' } }))
  // a store this version has already seen, with `saved` as the mode
  on('store.get', (_, e) => ({ value: e.key === 'background-mode-version' ? 2 : saved }))
  on('store.set', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
}

// A typed /workshop run, as the person's Enter in the desktop app.
const workshop = (args: string) => ({
  command: 'workshop',
  args,
  origin: { kind: 'composer' } as const,
  presentation: { isFullscreen: false, columns: 80 },
})

const BACKDROP = {
  plugin: 'nox-workshop',
  component: 'Backdrop',
  requestId: 'backdrop',
  props: { scene: 'krozmos', plugin: 'nox-workshop', glass: { blur: 0, opacity: 0.5 } },
} as const

test('the background starts live, and calm leaves the painting still', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const live = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })
  expect(await live.find({ type: 'Shader' })).toBeDefined()
  await live.unmount()

  const asked = await $.command.run(workshop(''))
  expect(asked.text).toMatch(/is live/)

  const said = await $.command.run(workshop('calm'))
  expect(said.text).toMatch(/calm/)

  const calm = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })
  expect(await calm.find({ type: 'Shader' })).toBeUndefined()
  expect(await calm.find({ type: 'Svg' })).toBeDefined()
  await calm.unmount()
})

test('a mode chosen in an earlier session is kept', async ($, on) => {
  engine(on, 'calm')
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })
  expect(await ui.find({ type: 'Shader' })).toBeUndefined()
  await ui.unmount()

  const said = await $.command.run(workshop(''))
  expect(said.text).toMatch(/is calm/)
})

test('an unknown mode is refused', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const said = await $.command.run(workshop('party'))
  expect(said.text).toMatch(/not a mode/)
})
