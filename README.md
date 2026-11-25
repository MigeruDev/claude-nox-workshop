# Nox Workshop: a Claude Desktop theme mod

A dark, clockwork time-magic theme for the Claude desktop app. It ships:

- an abyssal teal palette with near-white message text and translucent message cards;
- an animated backdrop: a glowing cube in a vector workshop, studied by robotic arms, firing cyan energy bursts;
- an animated gradient glow around the prompt box;
- a "deadline clock" ambience and heavy clockwork event sounds;
- a `/workshop live | calm | auto` command to pause the animation and save battery.

The mod uses only theme, store, command, clock and UI APIs. It makes no network calls, reads no files and runs no processes.

## Install

```bash
claude plugin marketplace add MigeruDev/claude-nox-workshop
claude plugin install nox-workshop@nox-mods --scope user
```

Then run `/reload-plugins` in Claude Code, or restart the app.

## Develop

```bash
claude plugin validate nox-workshop
claude plugin test nox-workshop
```

## License and disclaimer

The original code is MIT licensed. See [LICENSE](LICENSE), which also lists the content the license does not cover.

This is an unofficial, non-commercial fan project inspired by the Wakfu animated series. Wakfu and its characters and names are trademarks of Ankama. This project is not affiliated with or endorsed by Ankama. If a rights holder asks for anything to be removed, it will be removed.
