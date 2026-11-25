#!/bin/sh
# Coast Watch watchdog (run by tides-watchdog.timer every 2 minutes).
# Restarts tides-alola.service when the server stops answering: the page itself (covers tides and tido, same process)
# must answer within 15 s, and a data snapshot within 120 s (a snapshot is served from disk while the agencies are
# slow, so a timeout there means the server is wedged, not just NOAA being slow). Two misses in a row = restart.
PORT="${PORT:-8970}"
BASE="http://127.0.0.1:$PORT"
UNIT="${UNIT:-tides-alola.service}"

ok() {
  curl -fsS -o /dev/null -m 15 "$BASE/" &&
  curl -fsS -o /dev/null -m 15 -H "Host: tido.alola.lol" "$BASE/" &&
  curl -fsS -o /dev/null -m 120 "$BASE/snapshot/tides?region=sfbay"
}

ok && exit 0
sleep 20
ok && exit 0
echo "watchdog: $UNIT not answering, restarting it"
systemctl --user restart "$UNIT"
