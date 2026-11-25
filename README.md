# Nox Workshop: a Claude Desktop theme mod

A dark, clockwork time-magic theme for the Claude desktop app. It ships:

- an abyssal teal palette with near-white message text and translucent message cards;
- an animated backdrop: a glowing cube in a vector workshop, studied by robotic arms, firing cyan energy bursts;
- an animated gradient glow around the prompt box;
- a recorded background track and clockwork sound effects;
- a `/workshop` command for the background animation and the sound.

## Install

```bash
claude plugin marketplace add MigeruDev/claude-nox-workshop
claude plugin install nox-workshop@nox-mods --scope user
```

Then run `/reload-plugins` in Claude Code, or restart the app.

## Sound

Every sound is a recording in [nox-workshop/sounds](nox-workshop/sounds):

| When | What plays | File |
|---|---|---|
| Always, while sound is on | The background track, looped | `ambience` |
| Claude finishes a turn | The 4 s clockwork clip | `done` |
| An approval or a question waits for you | The clockwork clip's first 1.5 s | `click` |
| You click the bare background (not a panel) | The clockwork clip's first 1.5 s | `click` |

Nothing else makes a sound: no synthesized theme sound plays over the recordings.

Each file comes in two formats, one per platform:

| Platform | How it plays | Format |
|---|---|---|
| Linux | The system's player: PipeWire's `pw-play`, or PulseAudio's `paplay` | `.ogg` |
| macOS | The app itself, through `afplay` | `.flac` |
| Windows | Silent: neither way plays there | |

With several session tabs open, only one tab plays the background track. If that tab closes, another takes over within about 15 seconds.

### Muting

- **Right-click** anywhere on the background and choose **Mute the workshop**, or **Unmute the workshop** once muted. It's the only entry the mod adds to that menu.
- Or use `/workshop sound off` and `/workshop sound on`.

The choice applies to every tab and is remembered across sessions.

The app's own speaker icon in the header doesn't appear with this theme. That icon only switches a theme's synthesized sound, and the app never tells a mod whether it's on, so it can't control recordings.

## Commands

All settings other than mute are `/workshop` commands:

| Command | What it does |
|---|---|
| `/workshop` | Shows the background mode and whether sound is on |
| `/workshop live` | Background always animated (the default) |
| `/workshop calm` | Background shown as a still painting, so the GPU rests |
| `/workshop auto` | Animated while Claude works and for two minutes after, still otherwise |
| `/workshop sound on` | Plays the background track and the clockwork sounds |
| `/workshop sound off` | Silences them |

Each choice is remembered across sessions.

## What the mod uses

The mod uses the theme, store, command, clock and UI APIs. It makes no network calls.

To play sound, it starts processes on your machine:

- On Linux: `which` to find `pw-play` or `paplay`, the player itself (through `sh`, so the mod can stop the loop), and `kill` to stop the background track.
- On macOS: none. The app plays the files through `$.audio.play`.

It reads only its own sound files.

## Develop

```bash
claude plugin validate nox-workshop
claude plugin test nox-workshop
```

To change a sound, replace the file in `nox-workshop/sounds/` in both formats, keeping the name. For example, with `sox`:

```bash
sox my-track.wav -C 5 nox-workshop/sounds/ambience.ogg
sox my-track.wav -C 8 nox-workshop/sounds/ambience.flac
```

Volumes are set in `VOLUME` in [nox-workshop/hooks/sounds.ts](nox-workshop/hooks/sounds.ts).

## License and disclaimer

The original code is MIT licensed. See [LICENSE](LICENSE), which also lists the content the license does not cover.

This is an unofficial, non-commercial fan project inspired by the Wakfu animated series. Wakfu and its characters and names are trademarks of Ankama. This project is not affiliated with or endorsed by Ankama. If a rights holder asks for anything to be removed, it will be removed.
