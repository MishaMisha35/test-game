#!/usr/bin/env bash
# Optional Linux cloud-test helper. Uses preinstalled Xorg and xfwm4;
# it installs nothing and never replaces an existing display.
set -euo pipefail
ETERNAL_DISPLAY_NUMBER="${ETERNAL_DISPLAY_NUMBER:-99}"
if [[ ! "$ETERNAL_DISPLAY_NUMBER" =~ ^[0-9]+$ ]]; then
  printf '%s\n' 'ETERNAL_DISPLAY_NUMBER must be an integer.' >&2
  exit 2
fi
ETERNAL_DISPLAY=":${ETERNAL_DISPLAY_NUMBER}"
ETERNAL_SOCKET="/tmp/.X11-unix/X${ETERNAL_DISPLAY_NUMBER}"
ETERNAL_DISPLAY_DIR="/tmp/eternal-native-display-${ETERNAL_DISPLAY_NUMBER}"
ensure_window_manager() {
  # A real window manager is needed for native fullscreen requests. Reuse an
  # existing one; never pass --replace or change the user's desktop session.
  if command -v xprop >/dev/null && DISPLAY="$ETERNAL_DISPLAY" xprop -root _NET_SUPPORTING_WM_CHECK 2>/dev/null | grep -q 'window id #'; then
    return
  fi
  if command -v xfwm4 >/dev/null && command -v dbus-run-session >/dev/null; then
    mkdir -p "$ETERNAL_DISPLAY_DIR/config" "$ETERNAL_DISPLAY_DIR/cache"
    DISPLAY="$ETERNAL_DISPLAY" XDG_CONFIG_HOME="$ETERNAL_DISPLAY_DIR/config" XDG_CACHE_HOME="$ETERNAL_DISPLAY_DIR/cache" \
      nohup dbus-run-session -- xfwm4 --compositor=off --vblank=off \
      > "$ETERNAL_DISPLAY_DIR/xfwm.log" 2>&1 < /dev/null &
    printf '%s\n' "$!" > "$ETERNAL_DISPLAY_DIR/wm-pid"
    for _ in {1..60}; do
      if DISPLAY="$ETERNAL_DISPLAY" xprop -root _NET_SUPPORTING_WM_CHECK 2>/dev/null | grep -q 'window id #'; then
        return
      fi
      sleep 0.1
    done
    printf 'Window manager did not become ready; inspect %s\n' "$ETERNAL_DISPLAY_DIR/xfwm.log" >&2
    return 1
  fi
  printf '%s\n' 'No window manager is available; native fullscreen tests need a GUI session.' >&2
  return 2
}
if [[ -S "$ETERNAL_SOCKET" ]]; then
  ensure_window_manager
  printf 'Existing display available. Run tests with DISPLAY=%s\n' "$ETERNAL_DISPLAY"
  exit 0
fi
if ! command -v Xorg >/dev/null || [[ ! -r /usr/lib/xorg/modules/drivers/dummy_drv.so ]]; then
  printf '%s\n' 'Optional native cloud test needs Xorg with its dummy driver, or an existing GUI display.' >&2
  printf '%s\n' 'No system packages were changed. Renderer tests can still run in headless Chromium.' >&2
  exit 2
fi
mkdir -p "$ETERNAL_DISPLAY_DIR"
cat > "$ETERNAL_DISPLAY_DIR/xorg.conf" <<'CONFIG'
Section "ServerFlags"
  Option "AutoAddDevices" "false"
  Option "AutoEnableDevices" "false"
  Option "DontVTSwitch" "true"
EndSection
Section "Device"
  Identifier "dummy"
  Driver "dummy"
  VideoRam 256000
EndSection
Section "Monitor"
  Identifier "monitor"
  HorizSync 5.0 - 1000.0
  VertRefresh 5.0 - 200.0
  Modeline "1440x900" 106.5 1440 1520 1672 1904 900 903 909 934
EndSection
Section "Screen"
  Identifier "screen"
  Device "dummy"
  Monitor "monitor"
  DefaultDepth 24
  SubSection "Display"
    Depth 24
    Modes "1440x900"
  EndSubSection
EndSection
CONFIG
nohup Xorg "$ETERNAL_DISPLAY" -config "$ETERNAL_DISPLAY_DIR/xorg.conf" \
  -logfile "$ETERNAL_DISPLAY_DIR/xorg.log" -nolisten tcp -noreset \
  > "$ETERNAL_DISPLAY_DIR/stdout.log" 2>&1 < /dev/null &
ETERNAL_XORG_PID=$!
printf '%s\n' "$ETERNAL_XORG_PID" > "$ETERNAL_DISPLAY_DIR/pid"
for _ in {1..60}; do
  if [[ -S "$ETERNAL_SOCKET" ]]; then
    ensure_window_manager
    printf 'Native test display started. Run tests with DISPLAY=%s\n' "$ETERNAL_DISPLAY"
    exit 0
  fi
  if ! kill -0 "$ETERNAL_XORG_PID" 2>/dev/null; then
    printf 'Xorg exited; inspect %s\n' "$ETERNAL_DISPLAY_DIR/xorg.log" >&2
    exit 1
  fi
  sleep 0.1
done
printf 'Display did not become ready; inspect %s\n' "$ETERNAL_DISPLAY_DIR/xorg.log" >&2
exit 1
