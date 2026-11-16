// Corsa-e app: serves the personal remote-control page, guards everything
// behind a single-user login, and proxies psacc's API and UI.
const path = require("path");
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
} = process.env;

if (!APP_PASSWORD_HASH || !SESSION_SECRET) {
  console.error("APP_PASSWORD_HASH et SESSION_SECRET doivent être définis (voir .env.example).");
  process.exit(1);
}

const REMEMBER_MS = 90 * 24 * 3600 * 1000; // « rester connecté » : 90 jours
const FRONTEND = path.join(__dirname, "public");

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
  res.sendFile(path.join(FRONTEND, "login.html"));
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

// static assets needed by the login page (css, icons…)
app.use("/assets", express.static(path.join(FRONTEND, "assets")));

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

app.get("/api/me", (req, res) => res.json({ user: req.session.user, vin: VIN }));

app.get(["/corsa", "/seuil"], (req, res) => res.sendFile(path.join(FRONTEND, "index.html")));
app.use("/app", express.static(FRONTEND, { index: "index.html" }));

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
