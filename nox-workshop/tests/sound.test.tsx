import { expect, test } from 'claude-code/testing'

// Every sound is a recording played by sounds.ts: the look carries no
// synthesized theme sound, so none of the old clockwork cues plays over them.
test('the look is accepted and carries no synthesized sound', async ($, on) => {
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
  expect(JSON.stringify(looks[0]).includes('"sound"')).toBe(false)
})
