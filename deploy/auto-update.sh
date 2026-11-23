#!/bin/bash
# Mise à jour automatique : récupère le dépôt (configuration) et la dernière image publiée par GitHub,
# puis redémarre ce qui a changé. Lancé toutes les 5 minutes par corsa-auto-update.timer.
set -euo pipefail

DIR="$(dirname "$(readlink -f "$0")")"
[ "$(basename "$DIR")" = "deploy" ] && DIR="$(dirname "$DIR")"
cd "$DIR"
mkdir -p data
LOG=data/auto-update.log
log() { echo "$(date -Is) $*" >> "$LOG"; tail -n 200 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; }

# git tourne avec le propriétaire du dossier (le service tourne en root)
OWNER="$(stat -c %U .)"
as_owner() { if [ "$(id -u)" = 0 ] && [ "$OWNER" != root ]; then runuser -u "$OWNER" -- "$@"; else "$@"; fi; }

# 1) configuration (docker-compose.yml, scripts) depuis GitHub
before="$(as_owner git rev-parse HEAD)"
if ! as_owner git fetch -q origin main || ! as_owner git merge -q --ff-only origin/main; then
  log "git : mise à jour impossible (fichiers modifiés à la main ?) — on continue avec l'image"
fi
after="$(as_owner git rev-parse HEAD)"

# 2) psacc enregistre en permanence (le parcours des locataires est effacé par l'appli en fin de location)
export PSACC_OPTIONS="-c -r --web-conf"

# 3) image de l'appli : téléchargée seulement si GitHub en a publié une nouvelle
image="$(docker compose config --images | grep corsa-app | head -n1)"
old="$(docker image inspect -f '{{.Id}}' "$image" 2>/dev/null || true)"
if ! docker compose pull -q app; then log "téléchargement de l'image impossible"; exit 0; fi
new="$(docker image inspect -f '{{.Id}}' "$image" 2>/dev/null || true)"

if [ "$old" != "$new" ] || [ "$before" != "$after" ]; then
  docker compose up -d
  log "mise à jour installée (code ${after:0:7}, image ${new:7:12})"
fi
