#!/bin/zsh

cd "$(dirname "$0")" || exit 1

PYTHON_BIN="$(command -v python3)"
if [[ -z "$PYTHON_BIN" ]]; then
  echo "Python 3 was not found. Install Python 3, then run this launcher again."
  read -r "?Press Enter to close."
  exit 1
fi

PORT="${PORT:-4173}"
while lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

URL="http://127.0.0.1:$PORT/"
echo "ClassPilot AI is starting at $URL"

"$PYTHON_BIN" -m http.server "$PORT" --bind 127.0.0.1 >/tmp/classpilot-ai-server.log 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" >/dev/null 2>&1' EXIT INT TERM

for _ in {1..30}; do
  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    echo "ClassPilot AI could not start."
    cat /tmp/classpilot-ai-server.log
    read -r "?Press Enter to close."
    exit 1
  fi
  if curl -fsS "$URL" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

if [[ -z "$CLASSPILOT_NO_OPEN" ]]; then
  open "$URL"
fi

echo "ClassPilot AI is running. Keep this window open while using screenshot upload."
echo "Press Control-C here when you are finished."
wait "$SERVER_PID"
