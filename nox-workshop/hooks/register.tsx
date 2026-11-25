import type { EngineInterface, Register, ThemeSetArgs, ThemeSound, ThemeStyle, Timer } from 'claude-code'

import { makeColors } from './make-colors.js'
import { BODY, VB_H, VB_W } from './scene.js'

// The traced painting, wrapped two ways.
// FIT fills the box whole, stretched: the shader crops it itself, so it never
// distorts however the window is resized.
// STILL is the painting shown alone, with no shader: it covers the box pinned
// to the right edge and slid 50 units right, where the shader puts it in a
// window at least as wide as 16:9, with the painting mirrored into the gap
// that opens at the left.
const SLIDE = 50
const SCENE_FIT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB_W} ${VB_H}" preserveAspectRatio="none">${BODY}</svg>`
const SCENE_STILL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-SLIDE} 0 ${VB_W} ${VB_H}" preserveAspectRatio="xMaxYMid slice"><g id="p">${BODY}</g><use href="#p" transform="scale(-1 1)"/></svg>`
const SCENE_ALT = 'Mecha claws probing a glowing cube under a broken clock dial, wakfu energy swirling around it'

// How the background runs.
//   live  always animated
//   calm  a still painting, no shader: nothing for the GPU to do
//   auto  animated while Claude works and for two minutes after, still otherwise
// `/workshop <mode>` or the right-click menu sets it; it is remembered across sessions.
type Mode = 'live' | 'calm' | 'auto'
const MODES: readonly Mode[] = ['live', 'calm', 'auto']
const isMode = (value: unknown): value is Mode => MODES.some(one => one === value)
const MODE_KEY = 'background-mode'
const REST_AFTER_MS = 120_000
const SAID: Record<Mode, string> = {
  live: 'Workshop live: the background is always animated.',
  calm: 'Workshop calm: the background is a still painting, so the GPU rests. /workshop live brings the motion back.',
  auto: 'Workshop auto: the background animates while Claude works and for two minutes after, then rests.',
}

// live unless chosen otherwise
let mode: Mode = 'live'
// Bumped when the default changes, to move an earlier saved choice to it once
const MODE_VERSION = 2
const MODE_VERSION_KEY = 'background-mode-version'
// in auto: whether the background is animating now
let isAwake = true
let rest: Timer | undefined

const isAnimated = () => mode === 'live' || (mode === 'auto' && isAwake)
const redraw = ($: EngineInterface) => $.ui.invalidate('ui.render')

// Auto: wake the background now.
const wake = ($: EngineInterface) => {
  rest?.cancel()
  rest = undefined
  if (!isAwake) {
    isAwake = true
    if (mode === 'auto') {
      redraw($)
    }
  }
}

// Auto: let the background rest once nothing has happened for a while.
const restLater = ($: EngineInterface) => {
  rest?.cancel()
  rest = undefined
  if (mode !== 'auto') {
    return
  }
  rest = $.clock.after(REST_AFTER_MS, () => {
    rest = undefined
    if (mode === 'auto' && isAwake) {
      isAwake = false
      redraw($)
    }
  })
}

const setMode = async ($: EngineInterface, next: Mode) => {
  mode = next
  isAwake = true
  restLater($)
  redraw($)
  await $.store.set(MODE_KEY, next)
}

// Incantations the spinner speaks while a turn runs, by what the turn is doing.
const SPELLS: Record<string, readonly string[]> = {
  thinking: ['Consulting the Eliacube', 'Reading the threads of time', 'Weighing the hourglass'],
  requesting: ['Opening a temporal rift', 'Calling across the Krozmos', 'Winding the great spring'],
  responding: ['Inscribing the answer', 'Unspooling the hours', 'Channelling wakfu'],
  'tool-use': ['Winding the mecha arms', 'Turning the workshop gears', 'Calibrating the dial'],
  'tool-input': ['Setting the clockwork', 'Aligning the gears'],
}
const pick = (list: readonly string[]) => list[Math.floor(Math.random() * list.length)] ?? list[0] ?? ''

// The Krozmos workshop.
// Dark: the abyss Nox works in, lit by the cube's teal glow.
// Light: the god of time's dawn temple, pale celestial teal with gold.
// Gold stays the god's mark (warning), teal the cube (accent), neon cyan for pro marks.
const { theme, problems } = makeColors({
  label: 'Krozmos Workshop',
  roles: {
    accent: '#14b8b0', // cube teal
    danger: '#d1475e', // a clock struck wrong
    success: '#2fb36d', // cube green
    warning: '#c99a3b', // the god's gold
    pro: '#22d3ee', // neon cyan: the sidebar's branch icons and other "pro" marks
  },
  light: {
    gray: {
      anchors: {
        'surface-0': '#dce8e5',
        'surface-1': '#e6efed',
        'surface-2': '#f2f7f5',
        'text-primary': '#0b2229',
        'text-secondary': '#2b4a52',
        'text-muted': '#475f66',
      },
    },
  },
  dark: {
    gray: {
      anchors: {
        // deep blue-teal, the workshop's water: the sidebar, menus and panels
        'surface-0': '#0a1f27',
        'surface-1': '#0e252e',
        'surface-2': '#122b35',
        'surface-3': '#152f3a',
        // the app's text near-white; muted (icons, dim hints) is wakfu cyan.
        // The app colors all its text from these few colors, so no one row,
        // such as a session title, can take a color of its own
        'text-primary': '#e6f7f4',
        'text-secondary': '#c9dedc',
        'text-muted': '#7db5ae',
      },
    },
    // the branch icons in the sidebar take git's "merged" color: neon cyan
    git: { merged: '#22d3ee' },
  },
})

// Text containers over a clear canvas (dark mode only): one flat translucent
// color inside, no border, and a soft glow spilling outward from the edge.
// Every color behind the words must keep them at 3:1 or better, or the app
// drops the rule for its own plain look, so the cards stay dark and opaque enough.
// Message text stays near-white, whatever the app's own text color is
const MESSAGE_TEXT = '#e6f7f4'
const CODEX_BG = 'rgba(8, 22, 30, 0.85)'
const SLATE_BG = 'rgba(12, 34, 42, 0.85)'
const TOOL_BG = 'rgba(5, 13, 18, 0.82)'

const STYLE: ThemeStyle = {
  Text: { fontFamily: ['sans'], fontSize: 15, lineHeight: 24 },
  Heading: { fontFamily: ['serif'], fontWeight: 'semibold', letterSpacing: 1.5, color: 'text-accent' },
  // Nox's commands: a dark slate with a teal neon glow, one corner cut like a clock hand.
  UserMessage: {
    color: MESSAGE_TEXT,
    backgroundColor: SLATE_BG,
    borderWidth: 0,
    radius: [16, 16, 3, 16],
    paddingX: 16,
    paddingY: 12,
    shadow: { x: 0, y: 0, blur: 18, color: '#19c3c040' },
  },
  // The god's answers: a dark codex card with a soft Krozmos-violet glow.
  AssistantMessage: {
    color: MESSAGE_TEXT,
    backgroundColor: CODEX_BG,
    borderWidth: 0,
    radius: 12,
    padding: 18,
    shadow: { x: 0, y: 0, blur: 14, color: '#7d5ce040' },
  },
  // The workshop's machinery.
  ToolUse: {
    fontFamily: ['code'],
    color: 'text-accent',
    backgroundColor: TOOL_BG,
    borderWidth: 0,
    radius: 6,
    paddingX: 10,
    paddingY: 4,
  },
}

// "The deadline": an original soundscape of an old clock in the workshop,
// heavy and tense. Its escapement ticks in runs of sharp metal clicks, half
// a second apart, a new run picking up as the last ends, like an old clock
// that catches now and then; under it a soft wooden knock and a low
// heartbeat keep a steady pulse, once a second; and once in a while the
// clock is being built around you: a ratchet wound, a gear dropped into
// place, a plate of metal ringing, a wheel grinding.
const SOUND: ThemeSound = {
  ambience: {
    reverb: 0.4,
    layers: [
      // tick-tock: runs of eight sharp clicks, half a second apart, about one
      // run after another (a run may last 4 s in all, so each is 3.5 s)
      { wave: 'square', scatter: 0.26, notes: ['E6', 'A5', 'E6', 'A5', 'E6', 'A5', 'E6', 'A5'], step: 0.5, attack: 0.002, release: 0.025, gain: 0.04, filter: { type: 'highpass', hz: 1200 } },
      // a soft wooden knock, steady once a second, so the beat never stops
      { wave: 'pink', drone: true, gain: 0.018, filter: { type: 'bandpass', hz: 700 }, tremolo: { hz: 1, depth: 1 } },
      // the heartbeat: a low throb in time with the tock
      { wave: 'sine', drone: true, notes: ['A1'], gain: 0.04, tremolo: { hz: 1, depth: 1 } },
      // assembly: a ratchet wound a few clicks at a time
      { wave: 'square', scatter: 0.04, notes: ['C6', 'D6', 'C6', 'E6', 'C6', 'D6'], step: 0.07, attack: 0.002, release: 0.02, gain: 0.03, filter: { type: 'highpass', hz: 1500 } },
      // a gear dropped into place
      { wave: 'triangle', scatter: 0.025, notes: ['G2', 'D2'], attack: 0.002, release: 0.3, gain: 0.05, glide: -4 },
      // a plate of metal ringing
      { wave: 'bell', scatter: 0.02, notes: ['D4', 'A3'], release: 2, gain: 0.04, pan: 0.3 },
      // a wheel grinding against another
      { wave: 'crackle', scatter: 0.02, attack: 0.02, release: 0.4, gain: 0.03, filter: { type: 'bandpass', hz: 900 }, pan: -0.3 },
    ],
  },
  // Every cue is heavy clockwork, mechanical and dramatic: ticks are short
  // square tones lowered toward brass, each with a deep body under it; gears
  // land with low thuds; the great clock strikes on a bell over a low boom;
  // springs and grinding are bursts of filtered noise. A rest (0) holds a
  // layer back, so a strike can land after the ticks that lead to it.
  cues: {
    // you send: the mainspring is wound, ratchet clicks, then the latch drops home
    send: {
      reverb: 0.35,
      layers: [
        { wave: 'square', notes: ['C6', 'C6', 'D6', 'C6', 'D6', 'E6'], step: 0.06, attack: 0.002, release: 0.02, gain: 0.07, filter: { type: 'highpass', hz: 1500 } },
        { wave: 'white', attack: 0.04, release: 0.35, gain: 0.04, filter: { type: 'bandpass', hz: 700, to: 3800 } },
        { wave: 'triangle', notes: [0, 0, 0, 0, 0, 0, 'G2'], step: 0.06, attack: 0.002, release: 0.3, gain: 0.16, glide: -5 },
        { wave: 'pink', attack: 0.002, release: 0.1, gain: 0.08, filter: { type: 'bandpass', hz: 650 } },
      ],
    },
    // a tool runs: a tick with a little weight under it
    tool: {
      layers: [
        { wave: 'white', attack: 0.002, release: 0.025, gain: 0.07, filter: { type: 'highpass', hz: 4000 } },
        { wave: 'triangle', notes: ['A3'], attack: 0.002, release: 0.05, gain: 0.05 },
      ],
    },
    // Claude is done: a heavy tick-tock, then the great clock strikes
    // (a cue may take 32 s of audio to render in all, rests and echo included)
    done: {
      reverb: 0.4,
      layers: [
        { wave: 'square', notes: ['E6', 'A5', 'E6', 'A5'], step: 0.25, attack: 0.002, release: 0.03, gain: 0.07, filter: { type: 'highpass', hz: 1200 } },
        { wave: 'triangle', notes: ['E3', 'A2', 'E3', 'A2'], step: 0.25, attack: 0.002, release: 0.08, gain: 0.08 },
        { wave: 'bell', notes: [0, 0, 0, 0, 'D4'], step: 0.25, release: 2, gain: 0.18 },
        { wave: 'sine', notes: [0, 0, 0, 0, 'D2'], step: 0.25, attack: 0.004, release: 1.6, gain: 0.12 },
      ],
    },
    // the conversation is compacted: the hands spin back, then slam to a stop
    compact: {
      reverb: 0.45,
      layers: [
        { wave: 'square', notes: ['C7', 'A6', 'F6', 'D6', 'B5', 'G5', 'E5', 'C5'], step: 0.035, attack: 0.002, release: 0.018, gain: 0.06, filter: { type: 'highpass', hz: 1500 } },
        { wave: 'triangle', notes: [0, 0, 0, 0, 0, 0, 0, 0, 'C2'], step: 0.035, attack: 0.002, release: 0.4, gain: 0.18, glide: -4 },
        { wave: 'bell', notes: [0, 0, 0, 0, 0, 0, 0, 0, 'C5'], step: 0.035, release: 1.4, gain: 0.08 },
      ],
    },
    // a question for you: two heavy ticks, then a bell asks
    ask: {
      reverb: 0.45,
      layers: [
        { wave: 'square', notes: ['B5', 0, 'B5'], step: 0.15, attack: 0.002, release: 0.03, gain: 0.07, filter: { type: 'highpass', hz: 1200 } },
        { wave: 'triangle', notes: ['E3', 0, 'E3'], step: 0.15, attack: 0.002, release: 0.1, gain: 0.08 },
        { wave: 'bell', notes: [0, 0, 0, 'A4', 'E5'], step: 0.15, release: 1.6, gain: 0.12 },
      ],
    },
    // something went wrong: gears grind and drop with a dull thud
    error: {
      reverb: 0.3,
      layers: [
        { wave: 'crackle', attack: 0.01, release: 0.5, gain: 0.12, filter: { type: 'bandpass', hz: 900 } },
        { wave: 'triangle', notes: ['D3', 'C#3'], step: 0.15, attack: 0.002, release: 0.5, gain: 0.14, glide: -6 },
        { wave: 'brown', attack: 0.002, release: 0.4, gain: 0.15, filter: { type: 'lowpass', hz: 220 } },
      ],
    },
    // a click on the bare background: one weighty tick, higher toward the right
    click: {
      reverb: 0.3,
      layers: [
        { wave: 'square', notes: ['G5', 'A5', 'B5', 'C6', 'D6', 'E6'], attack: 0.002, release: 0.025, gain: 0.07, filter: { type: 'highpass', hz: 1500 } },
        { wave: 'triangle', notes: ['A2', 'B2', 'C3', 'D3', 'E3', 'G3'], attack: 0.002, release: 0.1, gain: 0.07 },
      ],
    },
  },
}

const BASE: ThemeSetArgs = {
  colors: theme,
  // A dark veil over the app's panels, no blur: the painting stays sharp and
  // the app's own cards (task list, next-step box) stay readable.
  backdrop: { scene: 'krozmos', glass: { blur: 0, tint: '#061217', opacity: 0.5 } },
  // The workshop is a night place: always dark.
  overrideColorScheme: 'dark',
}

// Whether the last look was sent while no app could draw it: then the next
// app to attach is sent it again. Otherwise an attach (switching tabs, say)
// sends nothing, so the app keeps its background running instead of
// rebuilding it.
let lookPending = false

// Sends the whole look. Called at start, and again when an app attaches
// after a send it missed.
const applyLook = async ($: EngineInterface) => {
  let set
  try {
    set = await $.theme.set({ ...BASE, style: STYLE, sound: SOUND })
  } catch (error) {
    // most likely the sound (too costly, or a build without theme sound):
    // keep everything else
    $.ui.log(`nox-workshop: look with sound refused, trying without it: ${String(error)}`)
    try {
      set = await $.theme.set({ ...BASE, style: STYLE })
    } catch (again) {
      $.ui.log(`nox-workshop: styles refused too, falling back to colors and background: ${String(again)}`)
      set = await $.theme.set(BASE)
    }
  }
  // with no app attached yet the theme waits for one; say so quietly
  lookPending = !set.isDrawn
  if (!set.isDrawn) {
    $.ui.log(`nox-workshop: ${set.reason}`)
  }
  redraw($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))

    if (unpainted !== undefined) {
      $.ui.toast(unpainted)
    }

    // clear what an older version of this mod left in the status line
    $.ui.status(undefined)
    await applyLook($)

    // the background's mode, as last chosen in any session
    const saved = await $.store.get(MODE_KEY)
    if ((await $.store.get(MODE_VERSION_KEY)) !== MODE_VERSION) {
      // this version's default is live: start there, whatever was saved before
      await $.store.set(MODE_KEY, 'live')
      await $.store.set(MODE_VERSION_KEY, MODE_VERSION)
    } else if (isMode(saved)) {
      mode = saved
    }
    isAwake = true
    restLater($)
    await $.command.register({
      name: 'workshop',
      description: 'Krozmos Workshop background: live, calm (still, saves battery) or auto',
      argumentHint: '[live|calm|auto]',
      immediate: true,
    })

    return next(e)
  })

  // An app joined the session after a look it could not draw: send it again.
  on('session.attach', async ($, e, next) => {
    const joined = await next(e)
    if (lookPending && (e.surface === 'desktop' || e.surface === 'mobile')) {
      await applyLook($)
    }

    return joined
  })

  on('command.run', { command: 'workshop' }, async ($, e) => {
    const asked = e.args.trim().toLowerCase()

    if (asked === '') {
      return { text: `The workshop background is ${mode}. Set it with /workshop live, /workshop calm or /workshop auto.` }
    }
    if (!isMode(asked)) {
      return { text: `"${asked.slice(0, 24)}" is not a mode. Use /workshop live, /workshop calm or /workshop auto.` }
    }
    await setMode($, asked)

    return { text: SAID[asked] }
  })

  // Auto: Claude at work wakes the background; a finished turn lets it rest later.
  on('turn.start', ($, e, next) => {
    wake($)

    return next(e)
  })
  on('turn.complete', ($, e, next) => {
    restLater($)

    return next(e)
  })

  // The same choice in the desktop app's right-click menu: the two modes
  // the background is not in.
  on('ui.render', { component: 'ContextMenu' }, ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const pick = async (next: Mode) => {
      await setMode($, next)
      $.ui.toast(SAID[next])
    }

    return (
      <Box flexDirection="column">
        {mode !== 'calm' && (
          <Button key="calm" onPress={() => pick('calm')}>
            Calm the workshop <Text dimColor>Still background, saves battery</Text>
          </Button>
        )}
        {mode !== 'live' && (
          <Button key="live" onPress={() => pick('live')}>
            Wake the workshop <Text dimColor>Always animated</Text>
          </Button>
        )}
        {mode !== 'auto' && (
          <Button key="auto" onPress={() => pick('auto')}>
            Workshop on auto <Text dimColor>Animated only while Claude works</Text>
          </Button>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if ((e.surface !== 'desktop' && e.surface !== 'mobile') || e.props.scene !== 'krozmos') {
      return next(e)
    }

    // Each session tab runs its own copy of this mod: take the mode last
    // chosen in any of them, so /workshop in one tab reaches every tab the
    // next time its background is drawn (switching to it, say).
    const saved = await $.store.get(MODE_KEY)
    if (isMode(saved) && saved !== mode) {
      mode = saved
      isAwake = true
      restLater($)
    }

    const { Shader, Svg } = $.ui.resolve(e)

    // The painting alone: on the mobile app, which plays no shader, and
    // while the background rests (calm, or auto between turns).
    if (e.surface === 'mobile' || !isAnimated()) {
      return <Svg source={SCENE_STILL} alt={SCENE_ALT} />
    }

    // Live: the shader crops the painting, moves the arms, relights the cube
    // and casts its wakfu.
    return (
      <Shader module="./wakfu.ts">
        <Svg source={SCENE_FIT} alt={SCENE_ALT} />
      </Shader>
    )
  })

  // Questions that ask you to pick: a glass card behind a neon rim, a dim
  // outer ring and a bright inner one, like a lit tube.
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    if (e.surface !== 'desktop') {
      return next(e)
    }
    const { Box } = $.ui.resolve(e)
    const dialog = await next(e)

    return (
      <Box borderStyle="round" borderColor="rgba(63, 224, 208, 0.35)">
        <Box borderStyle="round" borderColor="#5ff5e6" backgroundColor="rgba(8, 22, 30, 0.82)">
          {dialog}
        </Box>
      </Box>
    )
  })

  // The working line speaks in incantations. On the desktop it keeps a real step name.
  on('ui.render', { component: 'Spinner' }, ($, e, next) => {
    if (e.surface === 'desktop' && e.props.word !== 'Working') {
      return next(e)
    }
    const spells = SPELLS[e.props.mode] ?? SPELLS.thinking ?? []

    return next({ ...e, props: { ...e.props, word: pick(spells) } })
  })

  // The hint under the prompt: a draft is a spell ready to cast.
  on('ui.render', { component: 'PromptHint' }, ($, e, next) => {
    if (e.props.isDraft && !e.props.isWorking) {
      return next({ ...e, props: { ...e.props, hint: `✦ Spell inscribed. Enter to cast · ${e.props.hint}` } })
    }

    return next(e)
  })
}
