// Corsa-e app: serves the personal remote-control page, guards everything
// behind a single-user login, and proxies psacc's API and UI.
const path = require("path");
const fs = require("fs");
const express = require("express");
const cookieSession = require("cookie-session");
const bcrypt = require("bcryptjs");
const { createProxyMiddleware } = require("http-proxy-middleware");

const {
  APP_USER = "alexandre",
  APP_PASSWORD_HASH,
  SESSION_SECRET,
  VIN = "",
  PSACC_URL = "http://psacc:5000",
  PORT = "8080",
  COOKIE_SECURE = "false",
  PSACC_CONFIG_DIR = "/psacc-config", // dossier psacc monté en lecture seule
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

app.get("/api/me", async (req, res) => {
  let vin = VIN;
  try { vin = await getVin(); } catch (e) {}
  res.json({ user: req.session.user, vin });
});

app.get(["/corsa", "/seuil", "/setup"], (req, res) => sendApp(res));

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
