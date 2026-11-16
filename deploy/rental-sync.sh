#!/bin/bash
# Mode location : relance psacc SANS enregistrement (trajets, positions) pendant une location.
# L'appli écrit data/state.json ; ce script, lancé chaque minute par systemd, applique le mode.
set -euo pipefail
# dossier de l'installation (celui qui contient docker-compose.yml et data/)
DIR="$(dirname "$(readlink -f "$0")")"
[ "$(basename "$DIR")" = "deploy" ] && DIR="$(dirname "$DIR")"
cd "$DIR"
mkdir -p data

STATE=data/state.json
WITH_RECORD="-c -r --web-conf"     # options par défaut de l'image psacc
WITHOUT_RECORD="-c --web-conf"     # limite de charge conservée, rien n'est enregistré

if grep -q '"enabled":true' "$STATE" 2>/dev/null; then
  want="$WITHOUT_RECORD"; recording=off
else
  want="$WITH_RECORD"; recording=on
fi

current=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' psacc 2>/dev/null \
  | sed -n 's/^PSACC_OPTIONS=//p')

if [ "$current" != "$want" ]; then
  echo "$(date -Is) psacc -> enregistrement $recording"
  PSACC_OPTIONS="$want" docker compose up -d psacc
fi
echo "$recording" > data/recording
