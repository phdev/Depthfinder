#!/usr/bin/env bash
# Opt-in enable step for the "Open in Terminal" loopback helper.
#
# Installs + loads the dev.depthfinder.helper launchd job. The helper binds
# 127.0.0.1:4318 ONLY and is NEVER forwarded by the Cloudflare tunnel (which
# proxies only :4317), so it can't be reached from off-machine. It opens your
# Terminal with a Depthfinder prompt PRE-TYPED (you press Enter to run it).
#
# OFF by default — "Open in Terminal" only appears in the dashboard after you
# run this. Disable any time:
#   launchctl bootout gui/$(id -u)/dev.depthfinder.helper 2>/dev/null || \
#     launchctl unload ~/Library/LaunchAgents/dev.depthfinder.helper.plist
#   rm ~/Library/LaunchAgents/dev.depthfinder.helper.plist
set -euo pipefail

[ "$(uname)" = "Darwin" ] || { echo "macOS only (the helper uses Terminal.app via osascript)." >&2; exit 1; }
NODE="$(command -v node)" || { echo "node not found on PATH." >&2; exit 1; }
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/dev.depthfinder.helper.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs/Depthfinder"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.depthfinder.helper</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE}</string>
    <string>${DIR}/scripts/action-helper.mjs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>${DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${HOME}/Library/Logs/Depthfinder/helper.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/Library/Logs/Depthfinder/helper.log</string>
</dict>
</plist>
PLIST_EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "Enabled dev.depthfinder.helper (loopback 127.0.0.1:4318, opt-in, never tunneled)."
echo "'Open in Terminal' is now active in the dashboard Summary hotspots."
echo
echo "First click will ask macOS for Accessibility permission so it can pre-type"
echo "into Terminal (System Preferences > Privacy & Security > Accessibility)."
echo
echo "Disable: launchctl bootout gui/\$(id -u)/dev.depthfinder.helper; rm \"$PLIST\""
