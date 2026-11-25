// Partage du niveau de batterie vers l'ABRP du LOCATAIRE, pendant sa location uniquement.
//
// Le locataire scanne le QR code de la carte → page publique (port à part, publiée seule
// par Tailscale Funnel) → il relie SON compte ABRP (OAuth2 Iternio) ou colle son jeton
// « Generic » → l'appli envoie à ce jeton le niveau de batterie, l'autonomie et l'état de
// charge. JAMAIS la position. Le lien est effacé automatiquement à la fin de la location.

const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ABRP_AUTH = "https://abetterrouteplanner.com/oauth/auth";
const ABRP_TOKEN = "https://api.iternio.com/1/oauth/token";
const ABRP_SEND = "https://api.iternio.com/1/tlm/send";

const T = {
  fr: {
    title: "Batterie en direct dans ABRP",
    intro: "Reliez votre application A Better Routeplanner (ABRP) : elle recevra le niveau de batterie de la voiture pendant votre location. Seul le niveau de batterie est partagé, jamais la position.",
    before: "Avant de commencer : dans ABRP, ajoutez le véhicule « Opel Corsa-e (2020) ».",
    connect: "Relier mon ABRP", or: "ou",
    manual: "Coller mon jeton ABRP", manualHelp: "Dans ABRP : réglages du véhicule → Live data → Generic → copiez le jeton.",
    send: "Valider", linked: "Votre ABRP est relié", level: (l) => `Dernier niveau envoyé : ${l} %`, waiting: "Premier envoi dans une minute.",
    unlink: "Délier mon ABRP", off: "Disponible uniquement pendant une location.",
    bad: "Ce jeton ne semble pas valide.", fail: "La connexion à ABRP a échoué. Réessayez ou collez votre jeton.",
    end: "Le partage s’arrête automatiquement à la fin de votre location.",
  },
  nl: {
    title: "Batterij live in ABRP",
    intro: "Koppel je app A Better Routeplanner (ABRP): die krijgt tijdens je huurperiode het batterijniveau van de auto. Alleen het batterijniveau wordt gedeeld, nooit de locatie.",
    before: "Voeg eerst in ABRP het voertuig „Opel Corsa-e (2020)” toe.",
    connect: "Mijn ABRP koppelen", or: "of",
    manual: "Mijn ABRP-token plakken", manualHelp: "In ABRP: voertuiginstellingen → Live data → Generic → kopieer de token.",
    send: "Bevestigen", linked: "Je ABRP is gekoppeld", level: (l) => `Laatst verzonden niveau: ${l} %`, waiting: "Eerste verzending binnen een minuut.",
    unlink: "Mijn ABRP ontkoppelen", off: "Alleen beschikbaar tijdens een huurperiode.",
    bad: "Deze token lijkt niet geldig.", fail: "Koppelen met ABRP is mislukt. Probeer opnieuw of plak je token.",
    end: "Het delen stopt automatisch aan het einde van je huurperiode.",
  },
  en: {
    title: "Live battery in ABRP",
    intro: "Link your A Better Routeplanner (ABRP) app: it will receive the car’s battery level during your rental. Only the battery level is shared, never the location.",
    before: "Before you start: add the vehicle “Opel Corsa-e (2020)” in ABRP.",
    connect: "Link my ABRP", or: "or",
    manual: "Paste my ABRP token", manualHelp: "In ABRP: vehicle settings → Live data → Generic → copy the token.",
    send: "Confirm", linked: "Your ABRP is linked", level: (l) => `Last level sent: ${l} %`, waiting: "First update within a minute.",
    unlink: "Unlink my ABRP", off: "Only available during a rental.",
    bad: "This token does not look valid.", fail: "Linking with ABRP failed. Try again or paste your token.",
    end: "Sharing stops automatically when your rental ends.",
  },
};

const lang = (h = "") => {
  for (const p of String(h).toLowerCase().split(",")) { const c = p.trim().slice(0, 2); if (T[c]) return c; }
  return "en";
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const same = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

function startAbrpShare({ app: sharedApp, port, shareToken, publicBaseUrl, apiKey, clientId, dataDir, getStatus, getRental, log = console }) {
  if (!shareToken || shareToken.length < 12 || !apiKey) {
    log.log("partage ABRP locataire : désactivé (PUBLIC_SHARE_TOKEN ou ABRP_API_KEY manquant)");
    return null;
  }
  const file = path.join(dataDir, "abrp-renter.json");
  const load = () => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return {}; } };
  const save = (d) => { fs.writeFileSync(file + ".tmp", JSON.stringify(d)); fs.renameSync(file + ".tmp", file); };
  const currentRental = () => { const r = getRental(); return r && r.enabled ? String(r.rentalId || "rental") : null; };
  const base = String(publicBaseUrl || "").replace(/\/$/, "");
  const sharePath = `/a/${shareToken}`;
  const oauth = Boolean(clientId && base);
  const states = new Map(); // state OAuth → { rentalId, lang, at }

  // ---- envoi périodique vers l'ABRP du locataire ----
  async function sendOnce() {
    const link = load();
    const rid = currentRental();
    if (!link.token) return;
    if (!rid || link.rentalId !== rid) { save({}); log.log("partage ABRP locataire : fin de location, lien effacé"); return; }
    const s = await getStatus();
    const updated = s.updatedAt ? new Date(String(s.updatedAt).replace(" ", "T")) : new Date();
    const key = `${s.level}|${updated.getTime()}|${s.chargeStatus}`;
    if (link.lastKey === key && Date.now() - (link.lastSentAt || 0) < 5 * 60000) return;
    const tlm = { utc: Math.floor(updated.getTime() / 1000), soc: s.level, is_charging: s.chargeStatus === "InProgress" ? 1 : 0 };
    if (s.autonomy != null) tlm.est_battery_range = s.autonomy;
    const url = `${ABRP_SEND}?api_key=${encodeURIComponent(apiKey)}&token=${encodeURIComponent(link.token)}&tlm=${encodeURIComponent(JSON.stringify(tlm))}`;
    const r = await fetch(url, { method: "POST" });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || body.status === "error") throw new Error(`ABRP ${r.status} ${body.error || ""}`);
    save({ ...link, lastKey: key, lastSentAt: Date.now(), lastLevel: s.level });
  }
  setInterval(() => sendOnce().catch((e) => log.warn("partage ABRP locataire :", e.message)), 60000);

  // ---- page publique ----
  const app = sharedApp || express();
  if (!sharedApp) {
    app.disable("x-powered-by");
    app.set("trust proxy", "loopback");
  }
  app.use(express.urlencoded({ extended: false, limit: "4kb" }));
  const hits = new Map();
  app.use((req, res, next) => {
    const now = Date.now(); const k = req.ip || "?"; const h = hits.get(k) || { n: 0, t: now };
    if (now - h.t > 60000) { h.n = 0; h.t = now; }
    h.n += 1; hits.set(k, h); if (hits.size > 5000) hits.clear();
    if (h.n > 40) return res.status(429).end();
    res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY" });
    next();
  });
  const gate = (req, res, next) => (same(req.params.t, shareToken) ? next() : res.status(404).end());
  // formulaires : jeton anti-falsification (valable 30 min) + provenance quand le navigateur la donne
  const csrf = new Map();
  const newCsrf = () => {
    const v = crypto.randomBytes(18).toString("base64url");
    csrf.set(v, Date.now());
    for (const [k, at] of csrf) if (Date.now() - at > 30 * 60000) csrf.delete(k);
    return v;
  };
  const sameOrigin = (req, res, next) => {
    const o = req.get("origin");
    const okOrigin = !o || o === "null" || !base || o === new URL(base).origin;
    const v = String((req.body && req.body.csrf) || "");
    const okToken = csrf.has(v) && Date.now() - csrf.get(v) < 30 * 60000;
    if (!okOrigin || !okToken) return res.redirect(303, `${sharePath}?e=fail`);
    csrf.delete(v);
    next();
  };

  function render(req, res, msg = "") {
    const l = lang(req.get("accept-language")); const t = T[l];
    const rid = currentRental(); const link = load();
    const linked = rid && link.token && link.rentalId === rid;
    let body;
    if (!rid) body = `<p class="muted">${t.off}</p>`;
    else if (linked) {
      body = `<div class="ok">✓ ${t.linked}</div><p>${link.lastLevel != null ? t.level(link.lastLevel) : t.waiting}</p><p class="muted">${t.end}</p>
<form method="post" action="${sharePath}/unlink"><input type="hidden" name="csrf" value="${newCsrf()}"><button class="ghost" type="submit">${t.unlink}</button></form>`;
    } else {
      body = `<p>${t.intro}</p><p class="muted">${t.before}</p>
${oauth ? `<a class="btn" href="${sharePath}/connect">${t.connect}</a><p class="or">${t.or}</p>` : ""}
<form method="post" action="${sharePath}/token"><input type="hidden" name="csrf" value="${newCsrf()}"><label for="tok">${t.manual}</label><input id="tok" name="token" autocomplete="off" autocapitalize="off" spellcheck="false" required minlength="8" maxlength="200"><p class="muted small">${t.manualHelp}</p><button class="${oauth ? "ghost" : "btn"}" type="submit">${t.send}</button></form>
<p class="muted small">${t.end}</p>`;
    }
    const err = msg ? `<p class="err">${esc(t[msg] || "")}</p>` : "";
    res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://abetterrouteplanner.com; base-uri 'none'; frame-ancestors 'none'");
    res.type("html").send(`<!doctype html><html lang="${l}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${t.title}</title>
<style>:root{--a:#E0561B;--ink:#16181d;--mut:#5b5e66}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f6f2;color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{width:min(92vw,400px);background:#fff;border-radius:24px;padding:26px 22px;box-shadow:0 10px 30px rgba(0,0,0,.06);border-top:8px solid var(--a)}h1{margin:0 0 12px;font-size:22px;line-height:1.2}
.btn,.ghost{display:block;width:100%;min-height:48px;border-radius:14px;font:600 16px system-ui,sans-serif;text-align:center;text-decoration:none;padding:13px;border:0;cursor:pointer}.btn{background:var(--a);color:#fff}.ghost{background:#f0f0ea;color:var(--ink);margin-top:10px}
label{display:block;font-weight:600;margin-bottom:6px}input{width:100%;min-height:46px;border:1px solid #cfcfc8;border-radius:12px;padding:10px 12px;font:15px ui-monospace,monospace}
.muted{color:var(--mut)}.small{font-size:14px}.or{text-align:center;color:var(--mut);margin:12px 0}.ok{font-weight:700;color:#1d7a46;font-size:18px}.err{color:#a3361a;font-weight:600}</style></head>
<body><main><h1>${t.title}</h1>${err}${body}</main></body></html>`);
  }

  app.get("/a/:t", gate, (req, res) => render(req, res, String(req.query.e || "")));

  app.get("/a/:t/connect", gate, (req, res) => {
    const rid = currentRental();
    if (!rid || !oauth) return res.redirect(303, sharePath);
    const state = crypto.randomBytes(18).toString("base64url");
    states.set(state, { rentalId: rid, at: Date.now() });
    for (const [k, v] of states) if (Date.now() - v.at > 15 * 60000) states.delete(k);
    const q = new URLSearchParams({ client_id: clientId, scope: "set_telemetry", response_type: "code", redirect_uri: `${base}/abrp/callback`, state });
    res.redirect(303, `${ABRP_AUTH}?${q}`);
  });

  app.get("/abrp/callback", async (req, res) => {
    const st = states.get(String(req.query.state || ""));
    states.delete(String(req.query.state || ""));
    const code = String(req.query.auth_code || req.query.code || "");
    if (!st || !code || st.rentalId !== currentRental()) return res.redirect(303, `${sharePath}?e=fail`);
    try {
      const q = new URLSearchParams({ client_id: clientId, client_secret: apiKey, code });
      const r = await fetch(`${ABRP_TOKEN}?${q}`, { method: "POST" });
      const body = await r.json();
      if (!r.ok || !body.access_token) throw new Error(`token ${r.status}`);
      save({ rentalId: st.rentalId, token: body.access_token, via: "oauth", linkedAt: Date.now() });
      log.log("partage ABRP locataire : ABRP relié (OAuth)");
      res.redirect(303, sharePath);
    } catch (e) {
      log.warn("partage ABRP locataire : échec OAuth :", e.message);
      res.redirect(303, `${sharePath}?e=fail`);
    }
  });

  app.post("/a/:t/token", gate, sameOrigin, (req, res) => {
    const rid = currentRental();
    const token = String(req.body.token || "").trim();
    if (!rid) return res.redirect(303, sharePath);
    if (!/^[A-Za-z0-9._~-]{8,200}$/.test(token)) return res.redirect(303, `${sharePath}?e=bad`);
    save({ rentalId: rid, token, via: "manual", linkedAt: Date.now() });
    log.log("partage ABRP locataire : jeton ABRP collé");
    res.redirect(303, sharePath);
  });

  app.post("/a/:t/unlink", gate, sameOrigin, (req, res) => { save({}); res.redirect(303, sharePath); });

  if (!sharedApp) {
    app.use((req, res) => res.status(404).end());
    app.listen(Number(port), () => log.log(`partage ABRP locataire : page publique sur :${port}`));
  }

  return { status: () => { const l = load(); const rid = currentRental(); return { linked: Boolean(rid && l.token && l.rentalId === rid), lastSentAt: l.lastSentAt || null }; } };
}

module.exports = { startAbrpShare };
