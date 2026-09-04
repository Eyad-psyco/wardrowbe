#!/usr/bin/env bash
# Hot-patch live worker with prose→JSON AI repair and bump AI timeout.
set -eu
cd "${HOME}/wardrowbe"

echo "=== unload ollama models ==="
curl -sS http://172.17.0.1:11434/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"model":"moondream","keep_alive":0}' >/dev/null || true
curl -sS http://172.17.0.1:11434/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"model":"gemma3:1b","keep_alive":0}' >/dev/null || true
sleep 2
free -h

echo "=== bump AI_TIMEOUT in .env ==="
python3 - <<'PY'
from pathlib import Path
path = Path.home() / "wardrowbe" / ".env"
text = path.read_text()
lines = []
seen = False
for line in text.splitlines():
    if line.startswith("AI_TIMEOUT="):
        lines.append("AI_TIMEOUT=300")
        seen = True
    else:
        lines.append(line)
if not seen:
    lines.append("AI_TIMEOUT=300")
path.write_text("\n".join(lines) + "\n")
print("AI_TIMEOUT set to 300")
PY
grep '^AI_' .env

echo "=== recreate worker (pick up env from image first) ==="
docker compose up -d --force-recreate worker
sleep 3

echo "=== patch ai_service AFTER recreate (image would wipe it) ==="
docker compose cp /tmp/ai_service.py worker:/app/app/services/ai_service.py
docker compose cp /tmp/ai_service.py backend:/app/app/services/ai_service.py
docker compose restart worker backend
sleep 4
docker compose exec -T worker grep -q 'tags-repair' /app/app/services/ai_service.py
docker compose logs worker --tail=15

echo "=== smoke: prose→json via text model ==="
curl -sS --max-time 180 http://172.17.0.1:11434/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "gemma3:1b",
    "stream": false,
    "format": "json",
    "max_tokens": 400,
    "messages": [
      {"role": "system", "content": "OUTPUT ONLY JSON with keys type, primary_color, colors, pattern, formality. type must be jeans if denim pants."},
      {"role": "user", "content": "The image shows a mannequin displaying a pair of blue jeans against a white background."}
    ]
  }' | python3 -m json.tool | head -50

echo "DONE — re-run Analyze on one item in the UI."
