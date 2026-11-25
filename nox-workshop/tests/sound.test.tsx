import { expect, mock, test } from 'claude-code/testing'

// Every sound is a recording played by sounds.ts: the look carries no theme
// sound, so nothing synthesized plays over them.
test('the look is accepted and carries no theme sound', async ($, on) => {
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

// On macOS the app plays the recordings itself, from the FLAC copies
// (afplay reads FLAC, not Ogg): the background loops through $.audio.play.
test('on macOS the background track loops through the app', async ($, on) => {
  const plays: unknown[] = []
  on('session.info', () => ({ value: { platform: 'macos', transcriptPath: '' } }))
  on('audio.play', (_, e) => {
    plays.push(e)
    return { value: undefined }
  })
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'theme' } }))
  on('command.register', () => ({ value: { command: 'workshop' } }))
  mock.clock(on)
  mock.store(on, { 'background-mode-version': 2 })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // the loop starts in the background: let it reach the app
  for (let tick = 0; tick < 50 && plays.length === 0; tick++) {
    await Promise.resolve()
  }
  expect(JSON.stringify(plays)).toContain('sounds/ambience.flac')
  expect(JSON.stringify(plays)).toContain('"shouldLoop":true')
})

// The right-click menu holds one control: Mute while sound is on, Unmute once
// muted. The background modes are /workshop commands only.
test('the menu holds only Mute or Unmute', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  // on Linux, muting stops every background player, from any tab
  const ran: string[] = []
  on('session.info', () => ({ value: { platform: 'linux', transcriptPath: '' } }))
  on('process.run', (_, e) => {
    ran.push(e.argv.join(' '))
    return { value: { exitCode: 0, stdout: e.argv[0] === 'which' ? '/usr/bin/pw-play\n' : '', stderr: '' } }
  })
  const ui = await $.ui.mount({ plugin: 'nox-workshop', surface: 'desktop', component: 'ContextMenu', props: {} })
  expect(await ui.find({ key: 'mute' })).toBeDefined()
  for (const mode of ['calm', 'live', 'auto']) {
    expect(await ui.find({ key: mode })).toBeUndefined()
  }
  await ui.press({ key: 'mute' })
  expect(await ui.find({ key: 'unmute' })).toBeDefined()
  expect(ran.some(line => line.startsWith('pkill -f nox-workshop/'))).toBe(true)
  expect(await ui.find({ key: 'mute' })).toBeUndefined()
  await ui.press({ key: 'unmute' })
  expect(await ui.find({ key: 'mute' })).toBeDefined()
  await ui.unmount()
})

// Muting silences the background and the clicks, never the done sound: a
// finished turn is heard either way.
test('muted, a finished turn still plays the done sound', async ($, on) => {
  const plays: string[] = []
  on('session.info', () => ({ value: { platform: 'macos', transcriptPath: '' } }))
  on('audio.play', (_, e) => {
    plays.push(JSON.stringify(e))
    return { value: undefined }
  })
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'theme' } }))
  on('command.register', () => ({ value: { command: 'workshop' } }))
  mock.clock(on)
  mock.store(on, { 'background-mode-version': 2, 'file-sound': false })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  for (let tick = 0; tick < 50 && !plays.some(p => p.includes('done.flac')); tick++) {
    await Promise.resolve()
  }
  expect(plays.some(p => p.includes('sounds/done.flac'))).toBe(true)
  expect(plays.some(p => p.includes('ambience'))).toBe(false)
})
