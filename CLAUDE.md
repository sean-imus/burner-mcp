# CLAUDE.md

Working notes for Claude Code in this repo. README.md is the overview, HOW_TO_START.md covers daily use, and
TESTING.md has test results and known issues.

## What this is

A headless Android emulator (Android 17 Google Play image; AVD `burner` and adb serial `emulator-5554` by default)
driven by Claude through **burner-mcp** (`server/index.mjs`). burner-mcp is a Streamable HTTP MCP server on
`127.0.0.1:8790` with bearer-token auth. It runs mobile-mcp (pinned in `server/package-lock.json`) as a stdio child,
and exposes 7 compact tools: `screen`, `tap`, `type`, `swipe`, `press`, `open`, `reset`. Both the emulator and the
server run as systemd **user** services (`burner-emulator`, `burner-mcp`), installed by `install.sh` on Arch-based
distros. The default is local-only; `--public` adds Tailscale Funnel and linger.

Settings live in `~/.config/burner-mcp/env`. The server gets them from systemd, `bin/config.sh` reads them for the
shell scripts, and `server/config.mjs` reads them for the JS clients, tests and eval.

## Rules

- **The repo is public.** Never commit anything from the phone or the host it runs on: installed apps, accounts,
  screenshots of personal screens, tokens, real `*.ts.net` hostnames (write `<host>.<tailnet>.ts.net`), eval
  transcripts or results. Keep the docs about the project, not about one machine.
- Personal or machine-specific notes go in gitignored `*.local.md` files.
- Commit or push only when the user asks. Before a push, read the outgoing diff: `git log -p --format= origin/main..HEAD`.

## Commands

```bash
npm --prefix server run screen        # what's on the phone right now (reads token/port from ~/.config/burner-mcp/env)
npm --prefix server run test          # 23 functional checks, ~1 min
npm --prefix server run robustness    # crash/restart/input/burst checks plus a soak (node server/robustness.mjs 10)
node eval/run.mjs burner haiku        # real-model task eval (also: burner sonnet, mobile haiku)
node server/mobile-call.mjs '[{"name":"mobile_list_elements_on_screen","arguments":{"device":"burner","format":"json"}}]'   # raw mobile-mcp
systemctl --user restart burner-mcp   # after editing server/index.mjs
journalctl --user -u burner-mcp -f    # per-call log
```

- **Every test run resets the phone** to the `clean` snapshot, losing anything done since. Tell the user first.
- **The model eval** creates a contact, sets an alarm and takes a photo. If real accounts are signed in on the phone,
  those can sync, so ask before running it.
- After changing burner-mcp's behavior: run `npm --prefix server run test`, bump `VERSION` in `server/index.mjs` and
  `server/package.json`, and update TESTING.md and README.md if the numbers or tools changed.

## Gotchas (details in TESTING.md)

- mobile-mcp refs (`@e12`) are positional and re-resolved at tap time. burner-mcp numbers its screens and shows refs
  as `@e12.7` (element 12 on screen 7). A tap is refused if that element has moved since screen 7 (`shownScreens`).
- mobile-mcp identifies emulators by AVD name, so burner-mcp drives the device whose id is `BURNER_AVD`.
- Apps draw buttons under the 3-button nav bar (y ≥ ~2274). Tapping their center hits Home, so `tapPoint()` taps the
  visible part.
- Typing right after tapping a search bar loses keys, because a new screen opens. `type into=` waits for a focused field.
- Some apps' launcher activity is an alias that mobilecli can't start, so `open` falls back to
  `adb shell monkey -p <pkg> -c android.intent.category.LAUNCHER 1`.
- Quick Settings tiles keep their on/off state on an unlabelled overlay (`qs_tile_toggle_target`), and `overlayState()`
  reads it. Android 17's Wi-Fi tile only disconnects; it doesn't turn Wi-Fi off.
- `uiautomator dump` doesn't work while mobile-mcp's device server is connected. Use `server/mobile-call.mjs` for raw data.
- `swipe` `direction` is the finger's direction (swipe `up` to see content further down).
- The emulator needs `platform-tools/` in the SDK even though adb comes from pacman. Both adbs speak protocol 41 and coexist.
- `-gpu auto` falls back to software rendering on some Intel GPUs (Iris Xe). `EMU_GPU=host` is the default.
- Loading a snapshot closes scrcpy, so `bin/emu-reset` reopens it.
- In shell checks, `pgrep -f <pattern>` also matches your own command line.
