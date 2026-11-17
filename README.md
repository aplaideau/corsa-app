# Ma Corsa-e

Télécommande personnelle pour une Opel Corsa-e, construite au-dessus de
[psa_car_controller](https://github.com/flobz/psa_car_controller) (psacc).

- interface issue du design Figma Make « Opel Corsa-e — Contrôle » (React, dossier `frontend/`) ;
- écran de connexion (un seul utilisateur, « rester connecté » 90 jours) ;
- tableau de bord : batterie, autonomie, session de recharge (puissance estimée, temps restant, heure de fin),
  limite de charge, préchauffage, recharge, verrouillage, localisation, mode clair/sombre ;
- assistant de configuration (`/setup`) : connexion MyOpel (avec récupération manuelle du code si besoin) puis validation SMS + PIN ;
- l'interface complète de psacc reste accessible derrière la même connexion.

## Architecture

```
téléphone ──Tailscale──▶ VM :8080 ─▶ corsa-app (login + page + proxy) ─▶ psacc :5000 ─▶ API Stellantis
```

| Service    | Image                                  | Rôle                                        |
|------------|----------------------------------------|---------------------------------------------|
| `psacc`    | `flobz/psa_car_controller`             | dialogue avec la voiture                     |
| `app`      | `ghcr.io/aplaideau/corsa-app` (ce dépôt)   | connexion, page, proxy vers psacc            |

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
sudo docker run --rm ghcr.io/aplaideau/corsa-app:latest node hash.js 'MonMotDePasse'   # ligne à coller dans .env
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
cd ~/corsa && git pull && sudo docker compose pull && sudo docker compose up -d
```

## Mode location

À activer pendant une location Getaround (menu Options de l'appli) :

| | Mode location |
|---|---|
| Position | masquée dans l'appli, carte et trajets psacc bloqués |
| Enregistrement (trajets, positions, charges) | arrêté : psacc relancé sans `-r` |
| ABRP | coupé, puis rétabli à la fin |
| Verrouillage Opel | bloqué (utiliser l'appli Getaround) |
| Batterie, autonomie, état de charge | visibles |
| Limite de charge | **reste active** |

L'appli écrit `data/state.json` ; le script `deploy/rental-sync.sh`, lancé chaque minute par
un timer systemd sur la VM, relance psacc avec ou sans enregistrement (`PSACC_OPTIONS`).

Installation sur la VM (une fois) :

```bash
cd ~/corsa && mkdir -p data
sudo cp deploy/corsa-rental-sync.service deploy/corsa-rental-sync.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now corsa-rental-sync.timer
```

### Activation automatique par e-mail

Une boîte Gmail dédiée reçoit, via un filtre de transfert de la boîte habituelle (`from:(getaround.com)`),
les e-mails Getaround. Le serveur la lit toutes les 2 minutes (IMAP, mot de passe d'application) :

- « Location #… débutée » (`rental_starts`) → mode location activé, avec le numéro et le retour prévu ;
- « Location #… terminée » (`rental_ends`, même numéro) → mode location désactivé ;
- pas d'e-mail de fin 2 h après le retour prévu → avertissement dans l'appli (rien n'est désactivé seul) ;
- e-mail Getaround non reconnu → avertissement dans l'appli ;
- e-mails de plus de 12 h ignorés ; les choix manuels restent prioritaires jusqu'au prochain e-mail.

Seuls le type d'événement, le numéro de location et les heures sont conservés (jamais le nom du locataire).
Les e-mails sont seulement marqués comme lus. Réglages : `MAIL_USER` et `MAIL_APP_PASSWORD` dans `.env`.

Pour tout arrêter (pause complète) : `sudo docker stop psacc`, puis `sudo docker start psacc`.

## Développement local

Interface (design Figma) : `frontend/`, React + Vite. `npm run dev` relaie les appels vers le serveur sur :8080.

```bash
cd server && npm install
APP_PASSWORD_HASH="$(node -e "console.log(require('bcryptjs').hashSync('test',12))")" \
SESSION_SECRET=dev VIN=VXK... PSACC_URL=http://localhost:5000 node index.js
```

## API de l'appli (pour les écrans)

Toutes les routes exigent d'être connecté (cookie de session), sauf `/login` et `/api/login`.

| Méthode | Route | Corps | Réponse |
|---|---|---|---|
| POST | `/api/login` | `{user, password, remember}` | `{ok}` ou 401 `{error}` |
| POST | `/api/logout` | – | `{ok}` |
| GET | `/api/me` | – | `{user, vin}` |
| GET | `/api/setup/status` | – | `{psacc, loggedIn, otp, vin}` |
| POST | `/api/setup/login` | `{email, password, country}` | `{status: "done"}` · `{status: "manual", authUrl}` · `{status: "error", message}` |
| POST | `/api/setup/code` | `{code}` (code seul ou adresse `mym…://…?code=…`) | `{status: "done" \| "error", message?}` |
| POST | `/api/setup/sms` | – | `{status: "sent" \| "error", message?}` |
| POST | `/api/setup/otp` | `{sms, pin}` | `{status: "done" \| "error", message?}` |

Routes psacc utilisées par la télécommande (relayées telles quelles) :
`/get_vehicleinfo/<vin>?from_cache=1`, `/charge_control?vin=<vin>[&percentage=85]`,
`/charge_now/<vin>/<0|1>`, `/preconditioning/<vin>/<0|1>`, `/wakeup/<vin>` (6 max / 20 min).

Logique d'aiguillage conseillée : si `loggedIn` est faux → assistant de configuration ;
si `otp` est faux → bandeau « terminer la configuration » (les commandes à distance ne marchent pas).

## Sécurité

- Le port 8080 ne doit **pas** être ouvert dans les règles réseau Oracle : l'accès passe uniquement par Tailscale.
- `.env` contient les secrets : il n'est jamais versionné.
- 5 mauvais mots de passe d'affilée bloquent la connexion 15 minutes.
