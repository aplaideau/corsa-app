// Corsa-e app: serves the personal remote-control page, guards everything
// behind a single-user login, and proxies psacc's API and UI.
const path = require("path");
const fs = require("fs");
const express = require("express");
const cookieSession = require("cookie-session");
const bcrypt = require("bcryptjs");
const { createProxyMiddleware } = require("http-proxy-middleware");
const { startMailWatcher, BOOKING_TYPES, brusselsDate } = require("./getaround-mail");
const { createSchedule } = require("./schedule");
const { startAbrpShare } = require("./abrp-share");
const { createNotifier, startVehicleMonitor } = require("./notifications");

const {
  APP_USER = "alexandre",
  APP_PASSWORD_HASH,
  SESSION_SECRET,
  VIN = "",
  PSACC_URL = "http://psacc:5000",
  PORT = "8080",
  COOKIE_SECURE = "false",
  PSACC_CONFIG_DIR = "/psacc-config", // dossier psacc monté en lecture seule
  DATA_DIR = "/data",                  // état de l'appli (mode location), partagé avec le script de la VM
  // page « Ouvrir / fermer » (boîtier Connect) de la voiture dans l'espace propriétaire Getaround
  GETAROUND_URL = "https://fr.be.getaround.com/dashboard/cars/1433374/open_management",
  // boîte dédiée qui reçoit (par transfert automatique) les e-mails Getaround
  MAIL_USER = "",
  MAIL_APP_PASSWORD = "",
  MAIL_IMAP_HOST = "imap.gmail.com",
  MAIL_IMAP_PORT = "993",
  MAIL_IMAP_TLS = "true",
  MAIL_CHECK_SECONDS = "120",
  MONITOR_SECONDS = "120",
  // adresse de contact exigée par les services de notifications (Apple refuse les adresses @localhost)
  VAPID_SUBJECT = "",
} = process.env;

if (!APP_PASSWORD_HASH || !SESSION_SECRET) {
  console.error("APP_PASSWORD_HASH et SESSION_SECRET doivent être définis (voir .env.example).");
  process.exit(1);
}

const REMEMBER_MS = 90 * 24 * 3600 * 1000; // « rester connecté » : 90 jours
// Built React app (frontend/dist), copied to server/public by the Dockerfile
const FRONTEND = process.env.FRONTEND_DIR || path.join(__dirname, "public");
const sendApp = (res) => res.set("Cache-Control", "no-cache").sendFile(path.join(FRONTEND, "index.html"));

const app = express();
app.set("trust proxy", true);

app.use(cookieSession({
  name: "corsa_session",
  secret: SESSION_SECRET,
  httpOnly: true,
  sameSite: "lax",
  secure: COOKIE_SECURE === "true",
}));

// ---- simple brute-force protection on login --------------------------------
const attempts = new Map(); // ip -> {count, until}
function tooManyAttempts(ip) {
  const a = attempts.get(ip);
  return a && a.until > Date.now();
}
function recordFailure(ip) {
  const a = attempts.get(ip) || { count: 0, until: 0 };
  a.count += 1;
  if (a.count >= 5) { a.until = Date.now() + 15 * 60 * 1000; a.count = 0; }
  attempts.set(ip, a);
}

// ---- public routes ---------------------------------------------------------
app.get("/healthz", (req, res) => res.send("ok"));

app.get("/login", (req, res) => {
  if (req.session && req.session.user) return res.redirect("/corsa");
  sendApp(res);
});

app.post("/api/login", express.json(), async (req, res) => {
  const ip = req.ip;
  if (tooManyAttempts(ip)) return res.status(429).json({ error: "Trop d'essais, réessaie dans 15 minutes." });
  const { user = "", password = "", remember = false } = req.body || {};
  const ok = user.trim().toLowerCase() === APP_USER.toLowerCase()
    && await bcrypt.compare(String(password), APP_PASSWORD_HASH);
  if (!ok) { recordFailure(ip); return res.status(401).json({ error: "Identifiant ou mot de passe incorrect." }); }
  attempts.delete(ip);
  req.session.user = APP_USER;
  req.session.remember = Boolean(remember);
  if (remember) req.sessionOptions.maxAge = REMEMBER_MS; // sinon : cookie effacé à la fermeture du navigateur
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => { req.session = null; res.json({ ok: true }); });

// static files of the app, needed by the login screen too (hashed names → long cache)
app.use("/assets", express.static(path.join(FRONTEND, "assets"), { immutable: true, maxAge: "1y" }));
app.use("/media", express.static(path.join(FRONTEND, "media"), { maxAge: "7d" }));
app.get("/favicon.png", (req, res) => res.sendFile(path.join(FRONTEND, "favicon.png")));
// appli installée sur l'écran d'accueil : service worker (notifications) et manifeste, sans connexion
app.get("/sw.js", (req, res) => res.set("Cache-Control", "no-cache").sendFile(path.join(FRONTEND, "sw.js")));
app.get("/manifest.webmanifest", (req, res) =>
  res.type("application/manifest+json").sendFile(path.join(FRONTEND, "manifest.webmanifest")));

// ---- everything below requires login ---------------------------------------
app.use((req, res, next) => {
  if (req.session && req.session.user) {
    // « rester connecté » : on prolonge le cookie à chaque visite (au plus une fois par heure)
    if (req.session.remember) {
      req.sessionOptions.maxAge = REMEMBER_MS;
      const now = Date.now();
      if (!req.session.touched || now - req.session.touched > 3600 * 1000) req.session.touched = now;
    }
    return next();
  }
  const wantsHtml = (req.headers.accept || "").includes("text/html");
  if (req.method === "GET" && wantsHtml) return res.redirect("/login");
  return res.status(401).json({ error: "Non connecté" });
});


// ---- psacc helpers ---------------------------------------------------------
async function psacc(pathname, { timeout = 15000 } = {}) {
  const r = await fetch(PSACC_URL + pathname, { signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`psacc ${pathname}: HTTP ${r.status}`);
  return r.json();
}

let cachedVin = VIN;
async function getVin() {
  if (cachedVin) return cachedVin;
  const cars = await psacc("/get_vehicles");
  if (Array.isArray(cars) && cars.length) cachedVin = cars[0].vin;
  return cachedVin;
}

// psacc's setup screens are Dash callbacks: we trigger them over HTTP like its own UI does.
async function dashCall(outputs, input, state, timeout) {
  const outs = outputs.map(([id, property]) => ({ id, property }));
  const body = {
    output: outs.length === 1 ? `${outs[0].id}.${outs[0].property}`
      : ".." + outs.map(o => `${o.id}.${o.property}`).join("...") + "..",
    outputs: outs.length === 1 ? outs[0] : outs,
    inputs: [{ id: input, property: "n_clicks", value: 1 }],
    changedPropIds: [`${input}.n_clicks`],
    state: Object.entries(state).map(([id, value]) => ({ id, property: "value", value })),
  };
  const r = await fetch(PSACC_URL + "/_dash-update-component", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeout),
  });
  if (r.status === 204) return { color: "secondary", text: "", hrefs: [] };
  if (!r.ok) throw new Error(`psacc a répondu HTTP ${r.status}`);
  const data = await r.json();
  const alert = data.response[outs[0].id][outs[0].property];
  return flattenAlert(alert);
}

function flattenAlert(node) {
  const out = { color: "secondary", text: "", hrefs: [] };
  const walk = (n) => {
    if (n == null) return;
    if (typeof n === "string" || typeof n === "number") { out.text += n; return; }
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.props) {
      if (n.type === "Alert" && n.props.color && out.color === "secondary") out.color = n.props.color;
      if (n.props.href) out.hrefs.push(n.props.href);
      if (n.type === "Textarea" || n.type === "Input") return; // debug blocks
      walk(n.props.children);
    }
  };
  walk(node);
  out.text = out.text.trim();
  return out;
}

function extractCode(input) {
  const s = String(input || "").trim();
  const m = /[?&]code=([^&\s]+)/.exec(s);
  return decodeURIComponent(m ? m[1] : s);
}

const setupError = (res, e) => res.status(502).json({ status: "error", message: e.message || String(e) });

// État de la configuration : compte MyOpel relié ? OTP configuré ?
app.get("/api/setup/status", async (req, res) => {
  const status = { psacc: false, loggedIn: false, otp: false, vin: null };
  try {
    const cars = await psacc("/get_vehicles");
    status.psacc = true;
    status.loggedIn = Array.isArray(cars) && cars.length > 0;
    if (status.loggedIn) status.vin = VIN || cars[0].vin;
  } catch (e) { /* psacc injoignable ou pas configuré */ }
  try { status.otp = fs.existsSync(path.join(PSACC_CONFIG_DIR, "otp.bin")); } catch (e) {}
  res.json(status);
});

// Étape 1 : identifiants MyOpel. psacc tente une connexion automatique ;
// sinon il renvoie le lien à ouvrir pour récupérer le code à la main.
app.post("/api/setup/login", express.json(), async (req, res) => {
  const { email, password, country = "BE", brand = "com.psa.mym.myopel" } = req.body || {};
  if (!email || !password) return res.status(400).json({ status: "error", message: "E-mail et mot de passe requis." });
  try {
    const r = await dashCall([["form_result", "children"]], "submit-form",
      { "psa-app": brand, "psa-email": email, "psa-password": password, "psa-countrycode": country.toUpperCase() }, 240000);
    cachedVin = VIN;
    if (r.color === "success") return res.json({ status: "done" });
    const manual = r.hrefs.find(h => h.includes("config_connect?url="));
    if (manual) {
      const authUrl = decodeURIComponent(manual.slice(manual.indexOf("url=") + 4));
      return res.json({ status: "manual", authUrl });
    }
    return res.json({ status: "error", message: r.text || "Échec de la connexion" });
  } catch (e) { return setupError(res, e); }
});

// Étape 1 bis : code récupéré à la main (on accepte aussi l'adresse complète mym…://…?code=…)
app.post("/api/setup/code", express.json(), async (req, res) => {
  const code = extractCode((req.body || {}).code);
  if (!code) return res.status(400).json({ status: "error", message: "Code manquant." });
  try {
    const r = await dashCall([["oauth-result", "children"]], "finish-oauth", { "psa-oauth-code": code }, 60000);
    if (r.color === "success") { cachedVin = VIN; return res.json({ status: "done" }); }
    return res.json({ status: "error", message: r.text || "Code refusé" });
  } catch (e) { return setupError(res, e); }
});

// Étape 2 : demander le SMS
app.post("/api/setup/sms", async (req, res) => {
  try {
    const r = await dashCall([["sms-demand-result", "children"]], "ask-sms", {}, 60000);
    if (r.color === "success") return res.json({ status: "sent" });
    return res.json({ status: "error", message: r.text || "Envoi du SMS impossible" });
  } catch (e) { return setupError(res, e); }
});

// Étape 2 bis : code SMS + PIN MyOpel
app.post("/api/setup/otp", express.json(), async (req, res) => {
  const { sms, pin } = req.body || {};
  if (!sms || !pin) return res.status(400).json({ status: "error", message: "Code SMS et PIN requis." });
  try {
    const r = await dashCall([["opt-result", "children"], ["otp-redirect-interval", "disabled"]], "finish-otp",
      { "psa-pin": String(pin).trim(), "psa-code": String(sms).trim() }, 90000);
    if (r.color === "success") return res.json({ status: "done" });
    return res.json({ status: "error", message: r.text || "Configuration OTP refusée" });
  } catch (e) { return setupError(res, e); }
});


// ---- mode location -----------------------------------------------------------
// Pendant une location : position masquée, ABRP coupé, enregistrement des trajets arrêté
// (appliqué par deploy/rental-sync.sh sur la VM), verrouillage Opel bloqué.
// La limite de charge reste active.
const STATE_FILE = path.join(DATA_DIR, "state.json");
const RECORDING_FILE = path.join(DATA_DIR, "recording"); // écrit par le script de la VM : on | off

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch (e) { return {}; }
}
function writeState(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE + ".tmp", JSON.stringify(state));
  fs.renameSync(STATE_FILE + ".tmp", STATE_FILE);
}
const schedule = createSchedule({ dataDir: DATA_DIR });
let abrpShare = null; // partage du niveau vers l'ABRP du locataire
const rentalActive = () => Boolean(readState().rental && readState().rental.enabled);

const OVERDUE_MS = 2 * 3600 * 1000;   // fin non confirmée 2 h après le retour prévu
const EVENT_MAX_AGE_MS = 12 * 3600 * 1000; // un e-mail plus ancien n'agit plus (ex. vieux e-mails non lus)

function rentalStatus() {
  const state = readState();
  const r = state.rental || { enabled: false };
  const mail = state.mail || {};
  let recording = "unknown";
  try { recording = fs.readFileSync(RECORDING_FILE, "utf8").trim(); } catch (e) {}
  const plannedEnd = r.plannedEnd ? new Date(r.plannedEnd) : null;
  const recent = (x) => x && !x.dismissed && Date.now() - new Date(x.at).getTime() < 7 * 24 * 3600 * 1000;
  return {
    enabled: Boolean(r.enabled),
    since: r.since || null,
    source: r.source || null,
    rentalId: r.rentalId || null,
    plannedEnd: r.plannedEnd || null,
    overdue: Boolean(r.enabled && plannedEnd && Date.now() > plannedEnd.getTime() + OVERDUE_MS),
    recording,
    nextRental: schedule.next(),
    renterAbrp: abrpShare ? abrpShare.status() : null,
    mail: {
      configured: Boolean(MAIL_USER && MAIL_APP_PASSWORD),
      lastCheck: mail.lastCheck || null,
      lastError: mail.lastError || null,
      lastEvent: mail.lastEvent || null,
      lastUnrecognized: recent(mail.lastUnrecognized) ? mail.lastUnrecognized : null,
    },
  };
}

async function setRentalMode(enabled, meta = {}) {
  const state = readState();
  const current = state.rental || {};
  if (Boolean(current.enabled) === enabled) {
    // déjà dans le bon mode (ex. activé à la main) : on complète seulement les infos de location
    if (enabled && meta.rentalId) {
      state.rental = { ...current, rentalId: meta.rentalId, plannedEnd: meta.plannedEnd || current.plannedEnd || null };
      writeState(state);
    }
    return rentalStatus();
  }
  if (enabled) {
    // couper ABRP (il reçoit la position) en mémorisant ce qui était actif
    let abrpVins = [];
    try {
      const abrp = await psacc("/abrp");
      abrpVins = abrp.abrp_enable_vin || [];
      for (const v of abrpVins) await psacc(`/abrp?vin=${encodeURIComponent(v)}&enable=0`);
    } catch (e) { console.warn("mode location : ABRP non modifié", e.message); }
    state.rental = {
      enabled: true, since: new Date().toISOString(), abrpVins,
      source: meta.source || "manual", rentalId: meta.rentalId || null, plannedEnd: meta.plannedEnd || null,
    };
  } else {
    for (const v of current.abrpVins || []) {
      try { await psacc(`/abrp?vin=${encodeURIComponent(v)}&enable=1`); } catch (e) {}
    }
    state.rental = { enabled: false, since: null, source: meta.source || "manual" };
  }
  writeState(state);
  console.log(`mode location ${enabled ? "activé" : "désactivé"} (${meta.source || "manuel"}${meta.rentalId ? `, location #${meta.rentalId}` : ""})`);
  return rentalStatus();
}



// ---- notifications --------------------------------------------------------------
function vapidSubject() {
  const raw = (VAPID_SUBJECT || (MAIL_USER.includes("@") ? MAIL_USER : "")).trim();
  if (/^(mailto:|https:\/\/)/.test(raw)) return raw;
  if (raw.includes("@")) return `mailto:${raw}`;
  console.warn("VAPID_SUBJECT absent : les notifications iPhone seront refusées (BadJwtToken). Ajoute VAPID_SUBJECT=ton@email dans .env");
  return "mailto:corsa-app@example.com";
}
const notifier = createNotifier({ dataDir: DATA_DIR, subject: vapidSubject() });
const BXL = (d, withDay = false) => new Intl.DateTimeFormat("fr-BE", {
  timeZone: "Europe/Brussels", hour: "2-digit", minute: "2-digit", ...(withDay ? { weekday: "short" } : {}),
}).format(new Date(d));

app.get("/api/push/config", (req, res) => res.json({ publicKey: notifier.publicKey, types: notifier.types }));
app.post("/api/push/subscribe", express.json(), (req, res) => {
  try { res.json(notifier.subscribe(req.body.subscription, req.headers["user-agent"])); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post("/api/push/get", express.json(), (req, res) => res.json(notifier.getPrefs((req.body || {}).endpoint)));
app.post("/api/push/prefs", express.json(), (req, res) => {
  try { res.json(notifier.setPrefs(req.body.endpoint, req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post("/api/push/unsubscribe", express.json(), (req, res) => { notifier.unsubscribe((req.body || {}).endpoint); res.json({ ok: true }); });
app.post("/api/push/test", express.json(), async (req, res) => {
  try { await notifier.test((req.body || {}).endpoint); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// mise à jour installée : au démarrage, si la version a changé, notification avec les nouveautés
// (changelog.tsv est généré par GitHub Actions : sha, date, sujet, lignes « Changelog: » en français)
const APP_VERSION = process.env.APP_VERSION || "dev";
function changelogSince(previous) {
  let lines = [];
  try { lines = fs.readFileSync(path.join(__dirname, "changelog.tsv"), "utf8").split("\n").filter(Boolean); } catch (e) { return []; }
  const items = [];
  for (const line of lines) {                       // du plus récent au plus ancien
    const [sha, , , trailers = ""] = line.split("\t");
    if (previous && sha.startsWith(previous)) break;
    // seules les lignes « Changelog: » (en français) sont annoncées ; le reste est interne
    items.push(...trailers.split("\x1f").map((t) => t.trim()).filter(Boolean));
  }
  return items;
}
// écran « Nouveautés » : versions ayant des changements visibles (lignes « Changelog: »)
app.get("/api/releases", (req, res) => {
  let lines = [];
  try { lines = fs.readFileSync(path.join(__dirname, "changelog.tsv"), "utf8").split("\n").filter(Boolean); } catch (e) {}
  const releases = [];
  for (const line of lines) {
    const [sha, date, , trailers = ""] = line.split("\t");
    const items = trailers.split("\x1f").map((t) => t.trim()).filter(Boolean);
    if (items.length) releases.push({ version: sha.slice(0, 7), date, items, installed: APP_VERSION.startsWith(sha) || sha.startsWith(APP_VERSION) });
  }
  // la version installée n'a pas forcément de note : la plus récente avec une note est alors la courante
  if (releases.length && !releases.some((r) => r.installed)) releases[0].installed = true;
  res.json({ version: APP_VERSION.slice(0, 7), releases });
});

setTimeout(async () => {
  if (APP_VERSION === "dev") return;
  const file = path.join(DATA_DIR, "version.json");
  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(file, "utf8")).version; } catch (e) {}
  if (previous === APP_VERSION) return;
  fs.writeFileSync(file, JSON.stringify({ version: APP_VERSION, installedAt: new Date().toISOString() }));
  if (!previous) return; // première installation : rien à annoncer
  const items = changelogSince(previous).slice(0, 6);
  const body = items.length ? items.map((i) => `• ${i}`).join("\n") : "• Corrections et améliorations internes";
  await notifier.notify("update", "Mise à jour installée", body, { tag: "update", url: "/corsa?view=releases" });
}, 20000);

// fin de location non confirmée : une seule notification par location
setInterval(async () => {
  const state = readState();
  const r = state.rental || {};
  if (!rentalStatus().overdue || r.overdueNotified) return;
  state.rental.overdueNotified = true;
  writeState(state);
  await notifier.notify("rental_overdue", `Location #${r.rentalId} : fin non confirmée`,
    `Retour prévu ${BXL(r.plannedEnd, true)}, aucun e-mail de fin reçu. Le mode location reste actif.`, { tag: `rental-${r.rentalId}` });
}, 120000);

// rappel de location : la veille à 19:00 (ou tout de suite si la réservation arrive après)
const bxlParts = (d) => Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit",
}).formatToParts(new Date(d)).map((p) => [p.type, p.value]));
const bxlDay = (d) => { const p = bxlParts(d); return Date.UTC(+p.year, +p.month - 1, +p.day); };
const BXL_DATE = (d) => new Intl.DateTimeFormat("fr-BE", {
  timeZone: "Europe/Brussels", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
}).format(new Date(d));
function reminderTime(r) {
  const p = bxlParts(r.start);
  const eve = brusselsDate(+p.year, +p.month - 1, +p.day - 1, 19, 0);
  const bookedAt = new Date(r.bookedAt || 0);
  return bookedAt > eve ? bookedAt : eve;
}
async function checkRentalReminders() {
  const now = Date.now();
  for (const r of schedule.upcoming()) {
    const start = new Date(r.start).getTime();
    if (r.reminded || start <= now || reminderTime(r).getTime() > now) continue;
    schedule.markReminded(r.rentalId);
    const days = Math.round((bxlDay(r.start) - bxlDay(now)) / 86400000);
    const when = days === 0 ? "aujourd'hui" : days === 1 ? "demain" : null;
    const hour = BXL(r.start);
    await notifier.notify("rental_reminder",
      when ? `Location ${when} à ${hour}` : `Location le ${BXL_DATE(r.start)}`,
      `Location #${r.rentalId} : ${BXL_DATE(r.start)} → ${BXL_DATE(r.end)}.`,
      { tag: `rental-${r.rentalId}` });
  }
}
setInterval(() => checkRentalReminders().catch((e) => console.warn("rappel de location :", e.message)), 5 * 60 * 1000);

// surveillance de la voiture : fin de charge, charge interrompue, batterie basse, connexion perdue
// état de la voiture utilisé par la surveillance et le partage ABRP du locataire
async function readVehicleStatus() {
  const vin = await getVin();
  if (!vin) throw new Error("VIN inconnu");
  const info = await psacc(`/get_vehicleinfo/${encodeURIComponent(vin)}?from_cache=1`);
  const cc = await psacc(`/charge_control?vin=${encodeURIComponent(vin)}`).catch(() => null);
  const e = (info.energy || []).find((x) => x.type === "Electric") || (info.energy || [])[0] || {};
  const c = e.charging || {};
  return {
    level: Math.round(Number(e.level) || 0),
    autonomy: e.autonomy ? Math.round(Number(e.autonomy)) : null,
    chargeStatus: String(c.status || "").split(".").pop() || null,
    plugged: Boolean(c.plugged),
    moving: Boolean(info.kinetic && info.kinetic.moving),
    threshold: cc && cc.percentage_threshold ? Number(cc.percentage_threshold) : 100,
    updatedAt: e.updated_at || null, // dernières données envoyées par la voiture
  };
}

startVehicleMonitor({
  notifier,
  intervalMs: Math.max(10, Number(MONITOR_SECONDS) || 120) * 1000,
  statePath: path.join(DATA_DIR, "monitor.json"),
  getMailError: () => {
    const m = readState().mail || {};
    return m.lastError ? { since: m.lastErrorSince || m.lastCheck } : null;
  },
  getStatus: readVehicleStatus,
});

// ---- e-mails Getaround → mode location automatique ----------------------------
function updateMailState(patch) {
  const state = readState();
  const mail = { ...(state.mail || {}), ...patch };
  if ("lastError" in patch) mail.lastErrorSince = patch.lastError ? (state.mail && state.mail.lastErrorSince) || new Date().toISOString() : null;
  state.mail = mail;
  writeState(state);
}

async function onGetaroundEvent(event) {
  const at = new Date(event.at);
  const summary = { type: event.type, rentalId: event.rentalId || null, at: at.toISOString() };
  if (event.type === "unrecognized") {
    updateMailState({ lastUnrecognized: { subject: event.subject, at: at.toISOString() } });
    return;
  }
  schedule.apply(event); // planning des locations (toujours, même pour un ancien e-mail)
  if (BOOKING_TYPES.includes(event.type)) {
    // prolongation pendant la location en cours : nouveau retour prévu
    const r = readState().rental || {};
    if (event.type === "modified" && r.enabled && r.rentalId === event.rentalId && event.plannedEnd) {
      const state = readState();
      state.rental = { ...state.rental, plannedEnd: event.plannedEnd.toISOString(), overdueNotified: false };
      writeState(state);
    }
    if (!event.backfill) updateMailState({ lastEvent: summary });
    return;
  }
  if (Date.now() - at.getTime() > EVENT_MAX_AGE_MS) {
    updateMailState({ lastEvent: { ...summary, ignored: "trop ancien" } });
    return;
  }
  const current = readState().rental || {};
  if (event.type === "start") {
    if (event.plannedEnd && event.plannedEnd.getTime() < Date.now()) {
      updateMailState({ lastEvent: { ...summary, ignored: "location déjà terminée" } });
      return;
    }
    await setRentalMode(true, {
      source: "email", rentalId: event.rentalId,
      plannedEnd: event.plannedEnd ? event.plannedEnd.toISOString() : null,
    });
    await notifier.notify("rental_start", `Location #${event.rentalId} débutée`,
      `Voiture ouverte à ${BXL(at)}${event.plannedEnd ? ` · retour prévu ${BXL(event.plannedEnd, true)}` : ""}.`,
      { tag: `rental-${event.rentalId}` });
  } else if (event.type === "end") {
    if (current.enabled && (!current.rentalId || current.rentalId === event.rentalId)) {
      await setRentalMode(false, { source: "email", rentalId: event.rentalId });
    }
    const details = [`Voiture fermée à ${BXL(at)}`];
    if (event.distanceKm != null) details.push(`${event.distanceKm} km parcourus`);
    if (event.levelPercent != null) details.push(`batterie ${event.levelPercent} %`);
    await notifier.notify("rental_end", `Location #${event.rentalId} terminée`, details.join(" · ") + ".",
      { tag: `rental-${event.rentalId}` });
  }
  updateMailState({ lastEvent: summary });
}

if (MAIL_USER && MAIL_APP_PASSWORD) {
  startMailWatcher({
    user: MAIL_USER,
    password: MAIL_APP_PASSWORD.replace(/\s+/g, ""), // Google affiche le mot de passe par blocs de 4
    host: MAIL_IMAP_HOST,
    port: Number(MAIL_IMAP_PORT),
    secure: MAIL_IMAP_TLS !== "false",
    intervalMs: Math.max(30, Number(MAIL_CHECK_SECONDS) || 120) * 1000,
    onEvent: onGetaroundEvent,
    onStatus: updateMailState,
  });
  console.log(`relève des e-mails Getaround activée (${MAIL_USER}, toutes les ${Math.max(30, Number(MAIL_CHECK_SECONDS) || 120)} s)`);
}

app.get("/api/rental-mode", (req, res) => res.json(rentalStatus()));
// bouton « Ignorer » du bandeau « e-mail Getaround non reconnu »
app.post("/api/mail/dismiss-unrecognized", (req, res) => {
  const state = readState();
  if (state.mail && state.mail.lastUnrecognized) state.mail.lastUnrecognized.dismissed = true;
  writeState(state);
  res.json(rentalStatus());
});
app.post("/api/rental-mode", express.json(), async (req, res) => {
  try { res.json(await setRentalMode(Boolean((req.body || {}).enabled))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// État du véhicule : position retirée en mode location
app.get("/get_vehicleinfo/:vin", async (req, res) => {
  try {
    const q = req.query.from_cache ? "?from_cache=1" : "";
    const info = await psacc(`/get_vehicleinfo/${encodeURIComponent(req.params.vin)}${q}`, { timeout: 60000 });
    if (rentalActive()) {
      delete info.last_position;
      if (info.kinetic) delete info.kinetic.speed;
      info.rental_mode = true;
    }
    res.json(info);
  } catch (e) { res.status(502).json({ error: "psacc ne répond pas (en pause ?)" }); }
});

app.get("/api/me", async (req, res) => {
  let vin = VIN;
  try { vin = await getVin(); } catch (e) {}
  res.json({ user: req.session.user, vin, getaroundUrl: GETAROUND_URL, version: APP_VERSION.slice(0, 7) });
});

app.get(["/corsa", "/seuil", "/setup"], (req, res) => sendApp(res));

// En mode location, seules ces routes psacc restent accessibles (pas de carte, trajets, verrouillage…)
const RENTAL_ALLOWED = [/^\/get_vehicles$/, /^\/charge_control$/, /^\/charge_now\//, /^\/preconditioning\//, /^\/wakeup\//];
app.use((req, res, next) => {
  if (!rentalActive() || RENTAL_ALLOWED.some((r) => r.test(req.path))) return next();
  const msg = "Mode location actif : la position, les trajets et le verrouillage sont désactivés.";
  if ((req.headers.accept || "").includes("text/html")) return res.status(423).send(`<p style="font-family:sans-serif;padding:2em">${msg}</p>`);
  res.status(423).json({ error: msg });
});

// psacc: API (get_vehicleinfo, charge_control, …) and its full Dash UI
app.use("/", createProxyMiddleware({
  target: PSACC_URL,
  changeOrigin: true,
  ws: true,
  on: {
    error: (err, req, res) => {
      if (res.writeHead && !res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "psacc ne répond pas (en pause ?)" }));
    },
  },
}));

app.listen(Number(PORT), () => console.log(`corsa-app en écoute sur :${PORT} → psacc ${PSACC_URL}`));

// page publique « batterie en direct dans ABRP » pour le locataire (QR code), sur un port à part
abrpShare = startAbrpShare({
  port: process.env.PUBLIC_PORT || 8081,
  shareToken: process.env.PUBLIC_SHARE_TOKEN || "",
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
  apiKey: process.env.ABRP_API_KEY || "",
  clientId: process.env.ABRP_CLIENT_ID || "",
  dataDir: DATA_DIR,
  getStatus: readVehicleStatus,
  getRental: () => readState().rental || null,
});
