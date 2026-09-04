#!/usr/bin/env bash
set -euo pipefail
cd "${HOME}/wardrowbe"

echo "=== memory ==="
free -h
echo "=== top mem ==="
ps aux --sort=-%mem | head -12
echo "=== compose ==="
docker compose ps
echo "=== models ==="
curl -sS --max-time 10 http://172.17.0.1:11434/api/tags -o /tmp/tags.json
python3 - <<'PY'
import json
print([m["name"] for m in json.load(open("/tmp/tags.json")).get("models", [])])
PY
echo "=== AI env ==="
grep '^AI_' .env || true
echo "=== ai_endpoints ==="
# service name from compose
for svc in postgres db backend; do
  if docker compose ps --services 2>/dev/null | grep -qx "$svc"; then
    echo "using service: $svc"
    docker compose exec -T "$svc" psql -U wardrobe -d wardrobe -c \
      "SELECT u.email, p.ai_endpoints FROM users u JOIN user_preferences p ON p.user_id = u.id;" \
      && break
  fi
done
