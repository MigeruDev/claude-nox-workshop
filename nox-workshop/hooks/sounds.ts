import type { EngineInterface, Timer } from 'claude-code'

// Recorded sounds, played with the mod instead of the theme's synthesizer.
//
// The theme's `sound` takes synthesized notes only, so the recordings in
// sounds/ are played another way:
//   macOS   by the app itself (`$.audio.play`, which runs afplay), from the
//           .flac copies, since afplay reads FLAC and not Ogg
//   Linux   by PipeWire's `pw-play` (or PulseAudio's `paplay`), from the .ogg
//           copies, since `$.audio.play` plays nothing on Linux
//   Windows silent: neither way plays there
// The files:
//   ambience  the background track, looped while sound is on
//   done      when Claude finishes a turn
//   click     a click on the bare background, and an approval or question
//             waiting for you
// `/workshop sound on|off` or the right-click menu switches them; the choice
// is kept across sessions.

const SOUND_KEY = 'file-sound'
const OWNER_KEY = 'ambience-owner'
// How loud each plays, 0 to 1. The background track is far louder than the
// clockwork clip, so it sits low.
const VOLUME = { ambience: 0.22, done: 0.8, click: 0.7, ask: 0.8 } as const
// which file each effect plays: an approval waiting takes the clockwork click
const EFFECT_FILE = { done: 'done', click: 'click', ask: 'click' } as const
// Every tab runs its own copy of the mod, and only one may play the background:
// the owner renews its claim every HEARTBEAT_MS; a claim older than STALE_MS
// (its tab closed or crashed) is free to take.
const HEARTBEAT_MS = 5_000
const STALE_MS = 15_000

type Effect = keyof typeof EFFECT_FILE
type Owner = { id: string; at: number }
// how this machine plays a file: through the app (macOS) or a system player
type Player = { kind: 'app' } | { kind: 'process'; bin: string }

// this copy of the mod, among the tabs
const ME = `nox-${Math.random().toString(36).slice(2)}`
// how files play here; null when nothing can play them
let player: Player | null | undefined
let isOn = true
let heartbeat: Timer | undefined
// the background loop: whether it should run, and how to stop what plays now
let isLooping = false
let loopPid: string | undefined
let loopAbort: AbortController | undefined
// effects that are sounding now, so a burst of clicks doesn't pile up
const sounding = new Set<Effect>()

const isOwner = (value: unknown): value is Owner =>
  typeof value === 'object' && value !== null && typeof (value as Owner).id === 'string' && typeof (value as Owner).at === 'number'

async function findPlayer($: EngineInterface) {
  if (player !== undefined) {
    return player
  }
  const { platform } = await $.session.info()
  if (platform === 'macos') {
    player = { kind: 'app' }

    return player
  }
  if (platform !== 'windows') {
    for (const name of ['pw-play', 'paplay']) {
      try {
        const found = await $.process.run(['which', name], { timeoutMs: 5_000 })
        if (found.exitCode === 0 && found.stdout.trim() !== '') {
          player = { kind: 'process', bin: found.stdout.trim() }

          return player
        }
      } catch {
        // try the next
      }
    }
  }
  player = null
  $.ui.log(`nox-workshop: no way to play the recorded sounds on ${platform ?? 'this machine'}, so they are off`)

  return player
}

// The player's argument vector for one file at a volume from 0 to 1. A shell
// prints its own pid and becomes the player, so the loop can be stopped.
function argv(bin: string, path: string, volume: number) {
  const level = bin.endsWith('paplay') ? `--volume=${Math.round(volume * 65536)}` : `--volume=${volume}`

  return ['sh', '-c', 'echo $$; exec "$@"', 'nox-play', bin, level, path]
}

// Plays one file to its end through a system player; resolves once it exits.
async function playWithProcess($: EngineInterface, bin: string, name: string, volume: number, onPid?: (pid: string) => void) {
  const run = $.process.spawn({ argv: argv(bin, `${$.plugin.root}/sounds/${name}.ogg`, volume) })
  let errors = ''
  for await (const { stream, text } of run) {
    if (stream === 'stdout' && onPid !== undefined) {
      const pid = text.trim().split('\n')[0]
      if (pid !== undefined && /^\d+$/.test(pid)) {
        onPid(pid)
      }
    } else if (stream === 'stderr') {
      errors += text
    }
  }
  const ended = await run.result
  // a killed loop ends by signal: that is a stop, not a failure
  if (ended.code !== 0 && ended.signal === null) {
    $.ui.log(`nox-workshop: ${name} player exited ${String(ended.code)}: ${errors.trim().slice(0, 200)}`)
  }
}

// Plays one effect file to its end, however this machine plays files.
async function playOnce($: EngineInterface, name: string, volume: number) {
  const how = await findPlayer($)
  if (how === null) {
    return
  }
  if (how.kind === 'app') {
    await $.audio.play({ asset: `sounds/${name}.flac` }, { gain: volume })

    return
  }
  await playWithProcess($, how.bin, name, volume)
}

// One effect, unless the same one is still sounding.
export function playEffect($: EngineInterface, effect: Effect) {
  if (!isOn || sounding.has(effect)) {
    return
  }
  sounding.add(effect)
  void playOnce($, EFFECT_FILE[effect], VOLUME[effect])
    .catch(error => $.ui.log(`nox-workshop: ${effect} sound failed: ${String(error)}`))
    .finally(() => sounding.delete(effect))
}

function startLoop($: EngineInterface) {
  if (isLooping) {
    return
  }
  isLooping = true
  void (async () => {
    const how = await findPlayer($).catch((error: unknown) => {
      $.ui.log(`nox-workshop: could not tell how to play sound here: ${String(error)}`)

      return null
    })
    if (how === null) {
      isLooping = false

      return
    }
    // the app loops the file itself until the signal aborts
    if (how.kind === 'app') {
      loopAbort = new AbortController()
      try {
        await $.audio.play({ asset: 'sounds/ambience.flac' }, { shouldLoop: true, gain: VOLUME.ambience, signal: loopAbort.signal })
      } catch (error) {
        $.ui.log(`nox-workshop: background sound failed: ${String(error)}`)
      }
      loopAbort = undefined
      isLooping = false

      return
    }
    // a system player plays it once: start it again as it ends
    let failures = 0
    while (isLooping && failures < 3) {
      const startedAt = await $.clock.now()
      try {
        await playWithProcess($, how.bin, 'ambience', VOLUME.ambience, pid => {
          loopPid = pid
        })
      } catch (error) {
        $.ui.log(`nox-workshop: background sound failed: ${String(error)}`)
      }
      loopPid = undefined
      // a player that quits at once is broken, not finished: stop retrying soon
      failures = (await $.clock.now()) - startedAt < 2_000 ? failures + 1 : 0
    }
    isLooping = false
  })()
}

async function stopLoop($: EngineInterface) {
  isLooping = false
  loopAbort?.abort()
  loopAbort = undefined
  const pid = loopPid
  loopPid = undefined
  if (pid !== undefined) {
    await $.process.run(['kill', pid], { timeoutMs: 5_000 }).catch(() => undefined)
  }
}

// Plays the background in this tab when sound is on and no other tab plays it.
async function claim($: EngineInterface) {
  // another tab may have switched sound: follow the saved choice
  const wasOn = isOn
  isOn = (await $.store.get(SOUND_KEY)) !== false
  if (isOn !== wasOn) {
    // the right-click menu shows Mute or Unmute from this: draw it again
    $.ui.invalidate('ui.render')
  }
  const now = await $.clock.now()
  const owner = await $.store.get(OWNER_KEY)
  const isMine = isOwner(owner) && owner.id === ME
  const isFree = !isOwner(owner) || now - owner.at > STALE_MS

  if (isOn && (isMine || isFree)) {
    await $.store.set(OWNER_KEY, { id: ME, at: now })
    startLoop($)
  } else {
    await stopLoop($)
    if (isMine) {
      await $.store.delete(OWNER_KEY)
    }
  }
}

export async function startSounds($: EngineInterface) {
  heartbeat?.cancel()
  heartbeat = $.clock.every(HEARTBEAT_MS, () => {
    void claim($)
  })
  await claim($)
}

export async function stopSounds($: EngineInterface) {
  heartbeat?.cancel()
  heartbeat = undefined
  await stopLoop($)
  const owner = await $.store.get(OWNER_KEY)
  if (isOwner(owner) && owner.id === ME) {
    await $.store.delete(OWNER_KEY)
  }
}

export function isSoundOn() {
  return isOn
}

export async function setSound($: EngineInterface, next: boolean) {
  await $.store.set(SOUND_KEY, next)
  await claim($)
}
