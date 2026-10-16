#!/usr/bin/env bash
# Installs the release DMG the way a user does (mount, copy EasyView_Md.app into Applications,
# open it through LaunchServices), checks the installed app, then removes it.
# Usage: macos-install-test.sh <dmg> <expected-version> <test-file> [logs-dir]
# INSTALL_DIR overrides the target folder (default /Applications) for local runs.
set -euo pipefail

DMG="$1"
EXPECTED_VERSION="$2"
TEST_FILE="$3"
LOGS_DIR="${4:-logs-install}"
INSTALL_DIR="${INSTALL_DIR:-/Applications}"
APP_NAME="EasyView_Md"
APP="$INSTALL_DIR/$APP_NAME.app"
BINARY="$APP/Contents/MacOS/$APP_NAME"
WAIT_SECONDS=25

mkdir -p "$LOGS_DIR"
LOGS_DIR="$(cd "$LOGS_DIR" && pwd)"
TEST_FILE="$(cd "$(dirname "$TEST_FILE")" && pwd)/$(basename "$TEST_FILE")"
MOUNT="$(mktemp -d /tmp/easyview-dmg.XXXXXX)"
STARTED_MARKER="$LOGS_DIR/.started"
touch "$STARTED_MARKER"

fail() { echo "::error::$*" >&2; exit 1; }

cleanup() {
  pkill -KILL -f "$BINARY" 2>/dev/null || true
  hdiutil detach "$MOUNT" -force >/dev/null 2>&1 || true
  rmdir "$MOUNT" 2>/dev/null || true
}
trap cleanup EXIT

[[ -f "$DMG" ]] || fail "DMG not found: $DMG"
[[ -f "$TEST_FILE" ]] || fail "Test file not found: $TEST_FILE"
[[ -e "$APP" ]] && fail "$APP already exists before the test"

echo "=== 1. Mount $DMG ==="
hdiutil attach "$DMG" -nobrowse -readonly -noautoopen -mountpoint "$MOUNT" | tee "$LOGS_DIR/hdiutil-attach.log"
[[ -d "$MOUNT/$APP_NAME.app" ]] || fail "DMG does not contain $APP_NAME.app"
[[ "$(readlink "$MOUNT/Applications" || true)" == "/Applications" ]] || fail "DMG is missing the Applications drop link"

echo "=== 2. Install into $INSTALL_DIR ==="
mkdir -p "$INSTALL_DIR"
ditto "$MOUNT/$APP_NAME.app" "$APP"
hdiutil detach "$MOUNT" | tee "$LOGS_DIR/hdiutil-detach.log"

echo "=== 3. Verify installed bundle ==="
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")"
[[ "$VERSION" == "$EXPECTED_VERSION" ]] || fail "Installed version $VERSION, expected $EXPECTED_VERSION"
# A broken (even ad-hoc) signature makes Apple silicon refuse to launch the app as "damaged".
codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 | tee "$LOGS_DIR/codesign.log" \
  || fail "codesign verification failed for the installed app"
[[ -x "$BINARY" ]] || fail "Missing executable $BINARY"

echo "=== 4. Launch through LaunchServices ==="
open -a "$APP" "$TEST_FILE"
WINDOW_COUNTER="$LOGS_DIR/count-windows.swift"
cat > "$WINDOW_COUNTER" <<'SWIFT'
import CoreGraphics
let owner = CommandLine.arguments[1]
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
print(windows.filter { ($0[kCGWindowOwnerName as String] as? String) == owner && ($0[kCGWindowLayer as String] as? Int) == 0 }.count)
SWIFT

elapsed=0
windows=0
while (( elapsed < WAIT_SECONDS )); do
  sleep 5
  elapsed=$((elapsed + 5))
  pgrep -f "$BINARY" >/dev/null || fail "$APP_NAME exited ~${elapsed}s after launch"
  windows="$(swift "$WINDOW_COUNTER" "$APP_NAME" 2>/dev/null || echo 0)"
  echo "t=${elapsed}s alive windows=$windows"
done
screencapture -x "$LOGS_DIR/screenshot.png" 2>/dev/null || echo "Screenshot unavailable"
(( windows > 0 )) || fail "No on-screen $APP_NAME window appeared"

CRASHES="$(find "$HOME/Library/Logs/DiagnosticReports" -name "${APP_NAME}*" -newer "$STARTED_MARKER" 2>/dev/null || true)"
if [[ -n "$CRASHES" ]]; then
  while IFS= read -r report; do cp "$report" "$LOGS_DIR/"; done <<< "$CRASHES"
  fail "Crash reports were written: $CRASHES"
fi

echo "=== 5. Quit and remove ==="
pkill -TERM -f "$BINARY" || true
for _ in 1 2 3 4 5; do pgrep -f "$BINARY" >/dev/null || break; sleep 1; done
pkill -KILL -f "$BINARY" 2>/dev/null || true
rm -rf "$APP"

echo "macOS DMG install test passed for $EXPECTED_VERSION"
