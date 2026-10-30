# Testing

Three layers, all runnable on the host while the phone and burner-mcp are running. Each one resets the phone, so
anything you've done on it since the `clean` snapshot is lost.

> **Real accounts on the phone?** The model eval creates a contact, sets an alarm and takes a photo. With a Google
> account signed in, the contact (and possibly the photo) can sync to that account. The functional and robustness
> suites only touch Settings and are safe. Run the eval on a phone without your accounts.

```bash
node server/test.mjs              # functional suite, ~1 min: every tool, checked against adb
node server/robustness.mjs 10     # crashes, phone restarts, odd input, bursts, 10-min soak
node eval/run.mjs burner haiku    # real-model tasks (also: burner sonnet, mobile haiku for comparison)
```

`server/test.mjs` also works against a remote host: `BURNER_MCP_URL=… BURNER_MCP_TOKEN=… BURNER_TEST_ADB=0 node server/test.mjs`.

## Results (2026-10, Android 17 emulator on an i7-1165G7 with Iris Xe graphics)

### Functional suite: 23/23

These cover auth (missing or wrong token → 401), the tool list and instructions, reset, compact screens with a
status line, and tapping by text, ref and coordinates (switch state checked with adb). Also scrolling and exact drags,
BACK/HOME, opening apps by name, typing into fields that open new screens, `clear`, `press times`, refusing stale
refs, screenshots with scale notes, clear errors, schema validation, and 3 concurrent clients.

### Robustness: 8/8

| Check | Result |
|---|---|
| mobile-mcp child killed | The next call recovered by itself (474 ms) |
| Phone down mid-session | Clear error in 5 s, no hang |
| Phone back up | Works again without restarting the server |
| 1000-character text | Typed completely (8.5 s) |
| Non-ASCII and emoji (`café über 東京`, `hi 👋`) | Typed correctly |
| Burst: 5 clients × 4 calls | 20/20 OK (serialized, 4.7 s) |
| 10-minute soak, mixed calls | 715 calls, 0 errors, p50 706 ms, p95 1.75 s, max 2.2 s |
| Memory over the soak | Server 110→117 MB, mobile-mcp 92→95 MB, emulator 5303→5304 MB |

### Real-model eval: 8 tasks, graded on the phone with adb

Every run starts from the clean snapshot. The model gets no built-in tools (only the phone) and the same short system
prompt. Cells show pass, turns, and total input tokens.

| Task | burner-mcp + Haiku | burner-mcp + Sonnet | plain mobile-mcp + Haiku |
|---|---|---|---|
| Turn off dark theme | ✅ 4t, 16k | ✅ 4t, 16k | ✅ 8t, 82k |
| Turn off Wi-Fi | ✅ 7t, 32k | ❌ 5t, 21k | ❌ 9t, 97k |
| Airplane mode on (starting inside Clock) | ✅ 5t, 23k | ✅ 6t, 27k | ✅ 10t, 133k |
| Brightness to minimum (slider) | ✅ 8t, 44k | ✅ 5t, 21k | ✅ 10t, 104k |
| Create a contact (form) | ✅ 21t, 168k | ✅ 21t, 145k | ✅ 40t, 508k |
| Set a 7:30 alarm | ✅ 8t, 38k | ✅ 7t, 35k | ✅ 17t, 332k |
| Read a heading in Chrome | ✅ 4t, 16k | ✅ 4t, 15k | ✅ 9t, 101k |
| Take a photo (first-run dialogs) | ✅ 5t, 28k | ✅ 5t, 19k | ✅ 26t, 325k |
| **Total** | **8/8, 62 turns, 365k in** | 7/8, 57 turns, 299k in | 7/8, 129 turns, 1,682k in |

On the same model, burner-mcp passed one more task with **half the turns and 4.6× fewer input tokens** (output: 5.9k
vs 17.1k). On `wifi_off` reruns, Haiku passed 3/3 and Sonnet 2/3 (see Known issues).

## Known issues

- **Android 17's Wi-Fi tile only disconnects.** Tapping it shows "Networks available" and the tile looks off, but the
  radio stays on. burner-mcp reports what the tile says. Models that take that shortcut (Sonnet 1 in 3) think Wi-Fi is off.
- **Unlabelled text fields.** Some forms (Contacts' name fields) expose neither a label nor a hint through mobile-mcp,
  so they show as `[edittext]`. Models handle it via refs or `image=true`, at a few extra turns.
- **Not covered by the automated tests:** Tailscale Funnel, the claude.ai custom connector, and the Claude mobile and
  desktop apps. Check those by hand after a `--public` install.
