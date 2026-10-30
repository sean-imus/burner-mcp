#!/usr/bin/env bash
# Undo install.sh: stop and remove the user services. --purge also deletes the token, the AVD and the Android SDK.
# Packages, linger and Java stay; the script prints how to remove those.
set -euo pipefail

PURGE=0
[ "${1:-}" = "--purge" ] && PURGE=1
source "$(dirname "$0")/bin/config.sh"   # for BURNER_AVD, before --purge deletes the env file

systemctl --user disable --now burner-mcp.service burner-emulator.service 2>/dev/null || true
rm -f "$HOME/.config/systemd/user/burner-mcp.service" "$HOME/.config/systemd/user/burner-emulator.service"
systemctl --user daemon-reload
echo "Removed the burner-emulator and burner-mcp services."

if (( PURGE )); then
  rm -rf "$HOME/.config/burner-mcp" "$HOME/.android/avd/$BURNER_AVD.avd" "$HOME/.android/avd/$BURNER_AVD.ini" \
    "$HOME/Android/Sdk" "$HOME/.local/state/burner-mcp"
  echo "Deleted the token, the $BURNER_AVD AVD, logs and ~/Android/Sdk."
fi

cat <<'EOF'

Left in place (remove by hand if you want):
  Claude:    claude mcp remove burner -s user   (or the Burner connector on claude.ai)
  Funnel:    tailscale funnel status          (turn off: sudo tailscale funnel --https=443 off)
  Linger:    sudo loginctl disable-linger "$USER"
  Packages:  sudo pacman -Rns scrcpy android-tools tailscale jre21-openjdk-headless   (whichever install.sh added)
  Java:      mise uninstall java@temurin-21.0.13+9.0.LTS   (if it came from mise)
EOF
