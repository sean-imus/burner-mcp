# Sourced by the other bin/ scripts. Device settings come from the environment, then ~/.config/burner-mcp/env.
if [ -r "$HOME/.config/burner-mcp/env" ]; then
  while IFS='=' read -r key value; do
    case "$key" in
      BURNER_AVD | BURNER_SERIAL | EMU_GPU | EMU_ANIMATIONS) [ -n "${!key+x}" ] || printf -v "$key" '%s' "$value" ;;
    esac
  done < "$HOME/.config/burner-mcp/env"
fi
BURNER_AVD="${BURNER_AVD:-burner}"
BURNER_SERIAL="${BURNER_SERIAL:-emulator-5554}"
