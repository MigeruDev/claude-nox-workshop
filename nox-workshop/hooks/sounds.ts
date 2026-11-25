import type { EngineInterface, Timer } from 'claude-code'

// Recorded sounds, played by the system's own player.
//
// The theme's `sound` takes synthesized notes only, and `$.audio.play` plays
// nothing on Linux, so the mod runs PipeWire's `pw-play` (or PulseAudio's
// `paplay`) on its own files in sounds/:
//   ambience.ogg  the background track, looped while sound is on
//   done.ogg      when Claude finishes a turn
//   click.ogg     a click on the bare background, and an approval or
//                 question waiting for you
// `/workshop sound on|off` switches them; the choice is kept across sessions.

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

// this copy of the mod, among the tabs
const ME = `nox-${Math.random().toString(36).slice(2)}`
// the player's path; null when there is none
let player: string | null | undefined
let isOn = true
let heartbeat: Timer | undefined
// the background loop: whether it should run, and the player it runs now
let isLooping = false
let loopPid: string | undefined
// effects that are sounding now, so a burst of clicks doesn't pile up
const sounding = new Set<Effect>()

const isOwner = (value: unknown): value is Owner =>
  typeof value === 'object' && value !== null && typeof (value as Owner).id === 'string' && typeof (value as Owner).at === 'number'

async function findPlayer($: EngineInterface) {
  if (player !== undefined) {
    return player
  }
  for (const name of ['pw-play', 'paplay']) {
    try {
      const found = await $.process.run(['which', name], { timeoutMs: 5_000 })
      if (found.exitCode === 0 && found.stdout.trim() !== '') {
        player = found.stdout.trim()

        return player
      }
    } catch {
      // try the next
    }
  }
  player = null
  $.ui.log('nox-workshop: no pw-play or paplay found, so the recorded sounds are off')

  return player
}

// The player's argument vector for one file at a volume from 0 to 1. A shell
// prints its own pid and becomes the player, so the loop can be stopped.
function argv(bin: string, file: string, volume: number) {
  const level = bin.endsWith('paplay') ? `--volume=${Math.round(volume * 65536)}` : `--volume=${volume}`

  return ['sh', '-c', 'echo $$; exec "$@"', 'nox-play', bin, level, file]
}

function file($: EngineInterface, name: string) {
  return `${$.plugin.root}/sounds/${name}.ogg`
}

// Plays one file to its end; resolves once the player has exited.
async function playFile($: EngineInterface, name: string, volume: number, onPid?: (pid: string) => void) {
  const bin = await findPlayer($)
  if (bin === null) {
    return
  }
  const run = $.process.spawn({ argv: argv(bin, file($, name), volume) })
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

// One effect, unless the same one is still sounding.
export function playEffect($: EngineInterface, effect: Effect) {
  if (!isOn || sounding.has(effect)) {
    return
  }
  sounding.add(effect)
  void playFile($, EFFECT_FILE[effect], VOLUME[effect])
    .catch(error => $.ui.log(`nox-workshop: ${effect} sound failed: ${String(error)}`))
    .finally(() => sounding.delete(effect))
}

function startLoop($: EngineInterface) {
  if (isLooping) {
    return
  }
  isLooping = true
  void (async () => {
    let failures = 0
    while (isLooping && failures < 3) {
      const startedAt = await $.clock.now()
      try {
        await playFile($, 'ambience', VOLUME.ambience, pid => {
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
  const pid = loopPid
  loopPid = undefined
  if (pid !== undefined) {
    await $.process.run(['kill', pid], { timeoutMs: 5_000 }).catch(() => undefined)
  }
}

// Plays the background in this tab when sound is on and no other tab plays it.
async function claim($: EngineInterface) {
  // another tab may have switched sound: follow the saved choice
  isOn = (await $.store.get(SOUND_KEY)) !== false
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
