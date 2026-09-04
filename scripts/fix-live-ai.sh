#!/usr/bin/env bash
# Fix live VPS AI tagging: better vision model + .env + worker restart.
set -euo pipefail

cd "${HOME}/wardrowbe"

echo "=== current AI config ==="
grep '^AI_' .env || true

echo "=== ollama models (via docker bridge) ==="
curl -sS --max-time 10 http://172.17.0.1:11434/api/tags | python3 -m json.tool | head -80

echo "=== user ai_endpoints ==="
docker compose exec -T db psql -U wardrobe -d wardrobe -c \
  "SELECT u.email, p.ai_endpoints IS NOT NULL AS has_endpoints, p.ai_endpoints
   FROM users u JOIN user_preferences p ON p.user_id = u.id;"

# Clear custom endpoints that can override/break live Ollama routing.
echo "=== clearing custom ai_endpoints ==="
docker compose exec -T db psql -U wardrobe -d wardrobe -c \
  "UPDATE user_preferences SET ai_endpoints = NULL WHERE ai_endpoints IS NOT NULL;"

# Prefer a small multimodal model that can follow JSON better than moondream.
# gemma3:4b is multimodal (~3.3GB Q4). Falls back to pulling if missing.
TARGET_VISION="${TARGET_VISION:-gemma3:4b}"
TARGET_TEXT="${TARGET_TEXT:-gemma3:4b}"

echo "=== pulling ${TARGET_VISION} (may take a while) ==="
# Use the system ollama user API; CLI as debian may hit empty ~/.ollama
curl -sS http://172.17.0.1:11434/api/pull -d "{\"name\":\"${TARGET_VISION}\"}" | tee /tmp/ollama-pull.log | tail -5

echo "=== update .env ==="
python3 - <<PY
from pathlib import Path
path = Path.home() / "wardrowbe" / ".env"
text = path.read_text()
replacements = {
    "AI_VISION_MODEL": "${TARGET_VISION}",
    "AI_TEXT_MODEL": "${TARGET_TEXT}",
    "AI_TAGGING_CONCURRENCY": "1",
    "AI_TIMEOUT": "300",
    "AI_MAX_RETRIES": "2",
}
lines = []
seen = set()
for line in text.splitlines():
    if not line or line.lstrip().startswith("#") or "=" not in line:
        lines.append(line)
        continue
    key, _, _ = line.partition("=")
    if key in replacements:
        lines.append(f"{key}={replacements[key]}")
        seen.add(key)
    else:
        lines.append(line)
for key, value in replacements.items():
    if key not in seen:
        lines.append(f"{key}={value}")
path.write_text("\n".join(lines) + "\n")
print("updated:", {k: replacements[k] for k in replacements})
PY

grep '^AI_' .env

echo "=== recreate worker to pick up env ==="
docker compose up -d --force-recreate worker
sleep 3
docker compose logs worker --tail=20

echo "=== verify ollama sees model ==="
curl -sS --max-time 10 http://172.17.0.1:11434/api/tags | python3 -c '
import json,sys
data=json.load(sys.stdin)
names=[m["name"] for m in data.get("models",[])]
print("models:", names)
'

echo "=== smoke: one chat completion (short) ==="
# Tiny non-image ping to confirm OpenAI-compat path works
curl -sS --max-time 120 http://172.17.0.1:11434/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d "{\"model\":\"${TARGET_VISION}\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with exactly: {\\\"ok\\\":true}\"}],\"stream\":false,\"max_tokens\":32}" \
  | python3 -m json.tool | head -40

echo "DONE. Trigger Analyze on one wardrobe item in the UI to confirm tagging."
