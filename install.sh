#!/usr/bin/env bash
# Set up a burner-mcp host on an Arch-based Linux machine: an Android emulator plus the burner-mcp server as user
# services. Safe to re-run; re-running is also the update path.
#
#   ./install.sh           local-only (default): services on http://127.0.0.1, used by Claude Code on this machine
#   ./install.sh --public  also keeps running without a login and publishes a public HTTPS URL via Tailscale Funnel,
#                          for a claude.ai custom connector (web, desktop, mobile apps)
#   (--local is accepted as an alias for the default.)
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
SDK="$HOME/Android/Sdk"
IMAGE="system-images;android-37.0;google_apis_playstore;x86_64"
PLATFORM="platforms;android-37.0"
MISE_JAVA="java@temurin-21.0.13+9.0.LTS"
PACMAN_JAVA=jre21-openjdk-headless
TOOLS_ZIP=commandlinetools-linux-15859902_latest.zip
TOOLS_SHA256=4e4c464f145a7512b57d088ac6c278c03c9eea610886b35a5e0804e74eedf583
CONF="$HOME/.config/burner-mcp"
UNITS="$HOME/.config/systemd/user"

PUBLIC=0
case "${1:-}" in
  "" | --local) ;;
  --public) PUBLIC=1 ;;
  *) echo "usage: $0 [--public]" >&2; exit 2 ;;
esac

step() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m%s\033[0m\n' "$*" >&2; exit 1; }

step "Checking this machine"
command -v pacman >/dev/null || die "Needs an Arch-based distro (pacman not found)."
[ "$(uname -m)" = x86_64 ] || die "Needs an x86_64 machine (the emulator image is x86_64)."
grep -Eq '(vmx|svm)' /proc/cpuinfo || die "No CPU virtualization (VT-x/AMD-V). Enable it in the BIOS/UEFI."
{ [ -r /dev/kvm ] && [ -w /dev/kvm ]; } || die "/dev/kvm isn't usable by $USER. Try: sudo usermod -aG kvm $USER, log out and back in."
free_gb=$(df -BG --output=avail "$HOME" | tail -1 | tr -dc 0-9)
[ "$free_gb" -ge 15 ] || die "Need about 15 GB free in $HOME (have ${free_gb} GB)."
echo "OK: KVM, ${free_gb} GB free"

step "System packages"
pkgs=(android-tools scrcpy unzip)
(( PUBLIC )) && pkgs+=(tailscale)
command -v node >/dev/null || pkgs+=(nodejs)
command -v npm >/dev/null || pkgs+=(npm)
# Java is only for the SDK tools. With mise (Omarchy has it) it stays user-local; otherwise it comes from pacman.
command -v mise >/dev/null || pkgs+=("$PACMAN_JAVA")
missing=$(pacman -T "${pkgs[@]}" || true)
if [ -n "$missing" ]; then
  echo "Installing: $missing (needs sudo)"
  # shellcheck disable=SC2086
  sudo pacman -S --needed --noconfirm $missing
else
  echo "All present."
fi
NODE="$(command -v node)"
"$NODE" --version >/dev/null   # lets mise auto-install a pinned node on first use
echo "node $("$NODE" --version)"

step "Java for the SDK tools (not made the system default)"
if command -v mise >/dev/null; then
  mise install "$MISE_JAVA"
  export JAVA_HOME; JAVA_HOME="$(mise where "$MISE_JAVA")"
else
  export JAVA_HOME=/usr/lib/jvm/java-21-openjdk
fi
"$JAVA_HOME/bin/java" -version 2>&1 | head -1

step "Android SDK command-line tools"
SDKMANAGER="$SDK/cmdline-tools/latest/bin/sdkmanager"
AVDMANAGER="$SDK/cmdline-tools/latest/bin/avdmanager"
if [ ! -x "$SDKMANAGER" ]; then
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  curl -fL --progress-bar -o "$tmp/tools.zip" "https://dl.google.com/android/repository/$TOOLS_ZIP"
  echo "$TOOLS_SHA256  $tmp/tools.zip" | sha256sum -c --quiet || die "Checksum mismatch for $TOOLS_ZIP"
  unzip -q "$tmp/tools.zip" -d "$tmp"
  mkdir -p "$SDK/cmdline-tools"
  mv "$tmp/cmdline-tools" "$SDK/cmdline-tools/latest"
else
  echo "Already installed."
fi

step "Emulator, platform tools and the Android 17 Google Play image (~4 GB)"
# Interactive on purpose: sdkmanager shows the Android SDK License Agreement and you answer y/N.
# The emulator refuses to start without platform-tools in the SDK, even though adb comes from pacman.
# (Ignore its "sdkmanager is deprecated" notice; filtering it would also hide the license prompt.)
"$SDKMANAGER" --install emulator platform-tools "$PLATFORM" "$IMAGE"
[ -f "$SDK/system-images/android-37.0/google_apis_playstore/x86_64/system.img" ] || die "System image missing (license declined?)."

step "Server config and token"
mkdir -p "$CONF"
chmod 700 "$CONF"
if [ ! -f "$CONF/env" ]; then
  token=$("$NODE" -e 'console.log(require("crypto").randomBytes(32).toString("base64url"))')
  (umask 077; printf 'BURNER_MCP_TOKEN=%s\nBURNER_MCP_PORT=8790\nBURNER_AVD=burner\nBURNER_SERIAL=emulator-5554\nEMU_GPU=host\n' \
    "$token" > "$CONF/env")
  echo "Created $CONF/env with a new random token."
else
  echo "Keeping existing $CONF/env."
fi
# shellcheck disable=SC1091
source "$CONF/env"
PORT="${BURNER_MCP_PORT:-8790}"
AVD="${BURNER_AVD:-burner}"
SERIAL="${BURNER_SERIAL:-emulator-5554}"

step "Virtual phone \"$AVD\""
CFG="$HOME/.android/avd/$AVD.avd/config.ini"
if [ ! -f "$CFG" ]; then
  # Prints a harmless "Could not load devices.xml" error for this image and still creates the AVD.
  echo no | "$AVDMANAGER" create avd -n "$AVD" -k "$IMAGE" -d pixel_7 >/dev/null 2>&1 || true
  [ -f "$CFG" ] || die "avdmanager failed to create the AVD."
fi
set_cfg() { if grep -q "^$1=" "$CFG"; then sed -i "s|^$1=.*|$1=$2|" "$CFG"; else echo "$1=$2" >> "$CFG"; fi; }
# avdmanager leaves the Play Store off and RAM at 2 GB for this image.
set_cfg PlayStore.enabled yes
set_cfg hw.ramSize 4096
set_cfg hw.keyboard yes
set_cfg hw.gpu.enabled yes
echo "OK: $CFG"

step "burner-mcp server dependencies"
npm --prefix "$REPO/server" ci --omit=dev --no-audit --no-fund --loglevel=error

step "User services"
if adb devices | grep -q "^$SERIAL" && ! systemctl --user is-active --quiet burner-emulator.service; then
  echo "Stopping the emulator that was started by hand, so the service can take over..."
  adb -s "$SERIAL" emu kill >/dev/null || true
  for _ in $(seq 60); do adb devices | grep -q "^$SERIAL" || break; sleep 1; done
fi
mkdir -p "$UNITS"
for unit in burner-emulator burner-mcp; do
  sed -e "s|@REPO@|$REPO|g" -e "s|@NODE@|$NODE|g" "$REPO/systemd/$unit.service" > "$UNITS/$unit.service"
done
systemctl --user daemon-reload
systemctl --user enable burner-emulator.service burner-mcp.service >/dev/null
echo "Booting the phone (the first boot can take a couple of minutes)..."
systemctl --user start burner-emulator.service
systemctl --user restart burner-mcp.service   # restart so a re-run picks up server changes

step "Clean snapshot for resets"
if adb -s "$SERIAL" emu avd snapshot list | grep -qw clean; then
  echo "Already saved."
else
  adb -s "$SERIAL" shell input keyevent KEYCODE_HOME
  sleep 2
  adb -s "$SERIAL" emu avd snapshot save clean >/dev/null
  echo "Saved snapshot \"clean\"."
fi

URL="http://127.0.0.1:$PORT/mcp"
if (( ! PUBLIC )) && command -v tailscale >/dev/null && tailscale funnel status 2>/dev/null | grep -q "127.0.0.1:$PORT"; then
  printf '\n\033[1;33mWarning:\033[0m Tailscale Funnel is still publishing this server on the internet.\n'
  echo "Turn it off with: sudo tailscale funnel --https=443 off"
fi
if (( PUBLIC )); then
  step "Keep running without a login (sudo)"
  if [ "$(loginctl show-user "$USER" -P Linger 2>/dev/null)" != yes ]; then
    sudo loginctl enable-linger "$USER"
  fi
  echo "Linger is on: the phone and server start at boot."

  step "Public HTTPS via Tailscale Funnel (sudo)"
  sudo systemctl enable --now tailscaled
  if ! tailscale status >/dev/null 2>&1; then
    echo "Log in to Tailscale with the link below:"
    sudo tailscale up
  fi
  echo "First Funnel on your tailnet? Tailscale prints a link to approve it; open it and come back."
  sudo tailscale funnel --bg "$PORT"
  dns=$(tailscale status --json | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).Self.DNSName.replace(/\.$/,"")))')
  URL="https://$dns/mcp"
fi

step "Checking the server"
for _ in $(seq 30); do curl -sf "http://127.0.0.1:$PORT/healthz" >/dev/null && break; sleep 1; done
"$NODE" "$REPO/server/call.mjs" '[{"name":"screen"}]' | head -6

cat <<EOF

$(printf '\033[1;32mDone!\033[0m') The phone is running and burner-mcp is serving it.

  URL:    $URL
  Token:  $BURNER_MCP_TOKEN    (also in $CONF/env)

EOF
if (( ! PUBLIC )); then
  if command -v claude >/dev/null && claude mcp get burner >/dev/null 2>&1; then
    echo "Claude Code already has the \"burner\" MCP server registered."
  else
    cat <<EOF
Add it to Claude Code on this machine:
  claude mcp add -s user --transport http burner $URL --header "Authorization: Bearer $BURNER_MCP_TOKEN"
EOF
  fi
  echo "From your phone: open this machine's Claude Code session with Remote Control, or SSH in."
else
  cat <<EOF
Add it to Claude once, and it shows up on web, desktop, mobile and Claude Code:
  claude.ai → Customize → Connectors → Add custom connector
    Name:            Burner
    URL:             $URL
    Request header:  Authorization = Bearer <the token above>

To watch the phone: run bin/emu-view on this machine, or see HOW_TO_START.md for watching from another one.
EOF
fi
