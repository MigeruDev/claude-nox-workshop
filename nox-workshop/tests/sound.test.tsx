import { expect, test } from 'claude-code/testing'

// The engine checks a theme's sound before it reaches the app (each cue must
// render within 32 seconds, among other limits) and refuses it whole; the
// mod then falls back to a look without sound, and logs why. Catch that.
test('the look is accepted with its sound', async ($, on) => {
  const logs: string[] = []
  const looks: unknown[] = []
  on('theme.set', (_, e) => {
    looks.push(e)
    return { value: { isDrawn: true, requestId: 'theme' } }
  })
  on('ui.log', (_, e) => {
    logs.push(String((e as { text?: unknown }).text ?? JSON.stringify(e)))
    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'workshop' } }))
  on('store.get', (_, e) => ({ value: e.key === 'background-mode-version' ? 2 : undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(logs.filter(l => /refused/.test(l))).toEqual([])
  expect(looks.length).toBe(1)
})
