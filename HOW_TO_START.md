# How to start

## Day to day

After `./install.sh`, the phone and the server are systemd **user services** that start when you log in. With linger
on (public mode turns it on), they start at boot even without a login. There's nothing to start by hand.

```bash
systemctl --user status burner-emulator burner-mcp     # are they up?
journalctl --user -u burner-mcp -f                    # one line per tool call: name, ok/failed, duration
systemctl --user restart burner-emulator              # reboot the phone (~30 s, keeps its state)
bin/emu-view             # watch it (scrcpy window)
bin/emu-reset            # back to the clean snapshot (~3 s)
```

**Updating:** `git pull`, then re-run the installer **in the same mode**: `./install.sh` (local) or
`./install.sh --public`. It's idempotent, keeps your token, and restarts the server. A local-mode run warns if Funnel is
still publishing the server.

**Saving the phone's state:** `reset` (Claude's tool, `bin/emu-reset` and every test run) goes back to the `clean`
snapshot. After you install apps or sign in somewhere, make that the new baseline:
`adb shell input keyevent KEYCODE_HOME && adb emu avd snapshot save clean`.

## Using it from Claude

**Local mode (default).** Claude Code on this machine talks to `http://127.0.0.1:8790/mcp`. The installer prints the
registration command; it's this, with your token from `~/.config/burner-mcp/env`:

```bash
claude mcp add -s user --transport http burner http://127.0.0.1:8790/mcp --header "Authorization: Bearer <token>"
```

Then just ask, e.g. "what's on the phone screen?" or "turn on dark mode on the phone". From your phone, open a Claude Code
session on this machine with **Remote Control** in the Claude app, or SSH in over Tailscale and run `claude`. Skills
saved in your claude.ai account (Customize → Skills) also reach Claude Code.

**Public mode (`--public`).** Add a claude.ai custom connector once (Customize → Connectors → Add custom connector):
the printed `https://…ts.net/mcp` URL, *No sign-in*, and a request header `Authorization` = `Bearer <token>`. It then
works in every Claude app, and shows up in Claude Code as `claude.ai Burner`.

**Switching from public to local** on an existing host:

```bash
sudo tailscale funnel --https=443 off
claude mcp add -s user --transport http burner http://127.0.0.1:8790/mcp --header "Authorization: Bearer <token>"
```

Then remove the connector on claude.ai (Customize → Connectors → Burner → ⋯ → Remove). The tool names stay the same, so
skills written for the connector keep working.

**Checking from a terminal**, with no Claude involved:

```bash
npm --prefix server run screen
```

That reads the URL and token from `~/.config/burner-mcp/env`. For another host, set `BURNER_MCP_URL` and `BURNER_MCP_TOKEN`
and run `node server/call.mjs '[{"name":"screen"}]'`.

## Watching the phone

- **On the host:** `bin/emu-view` opens a scrcpy window. You can click and type in it alongside Claude.
- **From another machine** (needs SSH access to the host; this is scrcpy's documented tunnel):
  ```bash
  ssh -CN -L5038:localhost:5037 -L27183:localhost:27183 <host>     # keep this running
  ```
  ```bash
  ADB_SERVER_SOCKET=tcp:localhost:5038 scrcpy --force-adb-forward  # in another terminal
  ```
  If the tunnel complains, run `adb start-server` on the host once.

## Settings (`~/.config/burner-mcp/env`)

| Variable | Default | |
|---|---|---|
| `BURNER_MCP_TOKEN` | random | The bearer token. Restart `burner-mcp` and update the registration or connector after changing it |
| `BURNER_MCP_PORT` | `8790` | Local port burner-mcp listens on (and that Funnel forwards to) |
| `BURNER_AVD` | `burner` | Which AVD the services run and burner-mcp drives. install.sh creates it if missing |
| `BURNER_SERIAL` | `emulator-5554` | Its adb serial. The emulator's console port follows it (`emulator-5556` → port 5556) |
| `EMU_GPU` | `host` | `swiftshader_indirect` = software rendering (slower, but needs no GPU) |
| `EMU_ANIMATIONS` | off | `1` keeps Android's animations |

Restart the matching service after editing.

## Without the services

The `bin/` scripts also work on their own, without systemd: `bin/emu-start` (boots the phone headless and waits),
`bin/emu-view`, `bin/emu-stop`, `bin/emu-reset`. If the `burner-emulator` service is installed, `emu-start` just starts
the service.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Claude Code has no phone tools | `claude mcp list` should show `burner … ✔ Connected`. MCP servers load when a session starts, so open a new session |
| Tools return "The phone isn't running" | `systemctl --user status burner-emulator`, then `journalctl --user -u burner-emulator` |
| 401 Unauthorized | The header must be exactly `Authorization: Bearer <token>`, with the token from the env file |
| Public connector can't connect | `curl https://<host>…ts.net/healthz` should return `{"ok":true}`. If not: `tailscale funnel status` |
| Phone doesn't boot after a reboot without a login | Probably no GPU outside a desktop session. Set `EMU_GPU=swiftshader_indirect` in the env file and restart `burner-emulator` |
| An app won't open via `open` | burner-mcp falls back to the launcher intent automatically. If it still fails, check `journalctl --user -u burner-mcp` |
| Claude taps the wrong thing in a game or custom app | Ask it to use `image=true` and coordinates. The server instructions already tell it how |
| Want a factory-fresh phone | `systemctl --user stop burner-emulator`, then `~/Android/Sdk/emulator/emulator -avd burner -wipe-data -no-window` once (your `BURNER_AVD`), then delete and re-save the `clean` snapshot |
