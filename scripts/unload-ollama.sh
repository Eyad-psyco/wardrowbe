#!/usr/bin/env bash
# Unload currently loaded Ollama models to free RAM.
set -eu
curl -sS http://172.17.0.1:11434/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"model":"moondream","keep_alive":0}' || true
curl -sS http://172.17.0.1:11434/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"model":"gemma3:1b","keep_alive":0}' || true
sleep 2
free -h
ps aux --sort=-%mem | head -8
