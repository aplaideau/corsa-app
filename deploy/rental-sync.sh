#!/bin/bash
# psacc enregistre en permanence (trajets, recharges), y compris pendant les locations :
# l'appli masque la position pendant la location et efface le parcours à la fin.
# Ce script, lancé chaque minute par systemd :
#  1) remet l'enregistrement s'il était coupé (anciennes versions qui le coupaient en location) ;
#  2) pendant une location, efface chaque minute les positions depuis son début ;
#     puis applique les effacements de parcours demandés par l'appli en fin de location
#     (data/privacy-queue.json) : latitude, longitude et altitude mises à NULL dans la base de
#     psacc pour la période de la location. Trajets (km, consommation) et recharges restent.
set -euo pipefail
# dossier de l'installation (celui qui contient docker-compose.yml et data/)
DIR="$(dirname "$(readlink -f "$0")")"
[ "$(basename "$DIR")" = "deploy" ] && DIR="$(dirname "$DIR")"
cd "$DIR"
mkdir -p data

WITH_RECORD="-c -r --web-conf"     # options par défaut de l'image psacc

want="$WITH_RECORD"; recording=on

current=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' psacc 2>/dev/null \
  | sed -n 's/^PSACC_OPTIONS=//p')

if [ "$current" != "$want" ]; then
  echo "$(date -Is) psacc -> enregistrement $recording"
  PSACC_OPTIONS="$want" docker compose up -d psacc
fi
echo "$recording" > data/recording

# 2) effacement du parcours des locataires (exécuté dans le conteneur psacc, propriétaire de la base)
#    un fichier par location dans data/privacy-queue/ ; supprimé une fois l'effacement fait
SCRUB=$(cat <<'PY'
import json, sqlite3, sys, os
from datetime import datetime, timezone
job = json.load(sys.stdin)
db = next((p for p in ("/config/info.db", "info.db") if os.path.exists(p)), None)
if db is None:
    sys.stderr.write("base psacc introuvable\n"); sys.exit(2)
iso = lambda s: datetime.fromisoformat(s.replace("Z", "+00:00"))
sql = lambda d: d.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
live = job["to"] == "now"  # location en cours : effacement continu jusqu'à maintenant
start = iso(job["from"])
end = datetime.now(timezone.utc) if live else iso(job["to"])
if not live and end > datetime.now(timezone.utc):
    sys.exit(3)  # marge de fin pas encore écoulée : on réessaiera
conn = sqlite3.connect(db, timeout=30)
cur = conn.execute("UPDATE position SET latitude=NULL, longitude=NULL, altitude=NULL "
                   "WHERE Timestamp >= ? AND Timestamp <= ? AND (latitude IS NOT NULL OR longitude IS NOT NULL)",
                   (sql(start), sql(end)))
conn.commit(); conn.close()
if cur.rowcount or not live:
    print("parcours efface%s : %d positions (%s -> %s UTC)" % (" (location en cours)" if live else "", cur.rowcount, sql(start), sql(end)))
PY
)
# location en cours : effacement chaque minute depuis le début de la location
if [ -s data/privacy-live.json ]; then
  if out=$(docker exec -i psacc python3 -c "$SCRUB" < data/privacy-live.json 2>&1); then
    [ -n "$out" ] && echo "$(date -Is) $out" >> data/privacy.log
  else
    echo "$(date -Is) échec effacement continu : $out" >> data/privacy.log
  fi
fi

for job in data/privacy-queue/*.json; do
  [ -e "$job" ] || continue
  if out=$(docker exec -i psacc python3 -c "$SCRUB" < "$job" 2>&1); then
    echo "$(date -Is) $out" >> data/privacy.log
    rm -f "$job"
  elif [ $? -ne 3 ]; then
    echo "$(date -Is) échec effacement ($job) : $out" >> data/privacy.log
  fi
done
