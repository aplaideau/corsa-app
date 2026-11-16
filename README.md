# Ma Corsa-e

Télécommande personnelle pour une Opel Corsa-e, construite au-dessus de
[psa_car_controller](https://github.com/flobz/psa_car_controller) (psacc).

- écran de connexion (un seul utilisateur, « rester connecté » 90 jours) ;
- page télécommande : batterie, charge (vitesse, heure de fin), limite de charge, préchauffage ;
- l'interface complète de psacc reste accessible derrière la même connexion.

## Architecture

```
téléphone ──Tailscale──▶ VM :8080 ─▶ corsa-app (login + page + proxy) ─▶ psacc :5000 ─▶ API Stellantis
```

| Service    | Image                                  | Rôle                                        |
|------------|----------------------------------------|---------------------------------------------|
| `psacc`    | `flobz/psa_car_controller`             | dialogue avec la voiture                     |
| `app`      | `ghcr.io/OWNER/corsa-app` (ce dépôt)   | connexion, page, proxy vers psacc            |

À chaque `git push` sur `main`, GitHub Actions construit l'image (amd64 + arm64)
et la publie sur GitHub Container Registry.

## Première installation sur la VM

```bash
# 1. Docker Compose
sudo dnf install -y docker-compose-plugin

# 2. Dossier de l'appli
mkdir -p ~/corsa && cd ~/corsa
#    → y créer docker-compose.yml (copie de celui du dépôt)
#    → y créer .env à partir de .env.example

# 3. Mot de passe et clé de session
sudo docker run --rm ghcr.io/OWNER/corsa-app:latest node hash.js 'MonMotDePasse'   # ligne à coller dans .env
openssl rand -hex 32                                                               # valeur de SESSION_SECRET

# 4. Remplacer l'ancienne installation (Caddy + psacc lancés à la main)
sudo docker rm -f caddy psacc

# 5. Démarrer
sudo docker compose up -d
sudo docker compose ps
```

La configuration psacc existante (`~/psacc` : MyOpel, OTP, limite de charge) est réutilisée telle quelle.

## Mettre à jour

```bash
cd ~/corsa && sudo docker compose pull && sudo docker compose up -d
```

## Pause pendant les locations

```bash
sudo docker stop psacc    # début de location
sudo docker start psacc   # fin de location
```

## Développement local

```bash
cd server && npm install
APP_PASSWORD_HASH="$(node -e "console.log(require('bcryptjs').hashSync('test',12))")" \
SESSION_SECRET=dev VIN=VXK... PSACC_URL=http://localhost:5000 node index.js
```

## Sécurité

- Le port 8080 ne doit **pas** être ouvert dans les règles réseau Oracle : l'accès passe uniquement par Tailscale.
- `.env` contient les secrets : il n'est jamais versionné.
- 5 mauvais mots de passe d'affilée bloquent la connexion 15 minutes.
