// Page publique « niveau de batterie » pour les locataires (QR code sur la carte dans la voiture).
// Serveur séparé, sur son propre port, publié seul sur Internet (Tailscale Funnel) :
// le reste de l'appli reste privé. N'expose QUE le niveau, l'autonomie, l'état de charge
// et l'heure des données — jamais la position — et seulement pendant une location.

const express = require("express");
const crypto = require("crypto");

const TEXTS = {
  fr: {
    title: "Batterie de la voiture", range: "d’autonomie estimée", charging: "En charge",
    updated: (t) => `Données de la voiture à ${t}`, now: "à l’instant",
    stale: (t) => `La voiture est en veille : niveau relevé à ${t}. Le tableau de bord affiche toujours le niveau exact.`,
    off: "Disponible uniquement pendant une location.", error: "Niveau indisponible pour le moment. Consultez le tableau de bord.",
    hint: "Entrez ce niveau dans votre planificateur (ABRP) au départ.",
  },
  nl: {
    title: "Batterij van de auto", range: "geschat bereik", charging: "Aan het laden",
    updated: (t) => `Gegevens van de auto om ${t}`, now: "zonet",
    stale: (t) => `De auto staat in slaapstand: niveau gemeten om ${t}. Het dashboard toont altijd het juiste niveau.`,
    off: "Alleen beschikbaar tijdens een huurperiode.", error: "Niveau momenteel niet beschikbaar. Kijk op het dashboard.",
    hint: "Geef dit niveau bij vertrek in je routeplanner (ABRP) in.",
  },
  en: {
    title: "Car battery", range: "estimated range", charging: "Charging",
    updated: (t) => `Car data from ${t}`, now: "just now",
    stale: (t) => `The car is asleep: level read at ${t}. The dashboard always shows the exact level.`,
    off: "Only available during a rental.", error: "Level unavailable right now. Check the dashboard.",
    hint: "Enter this level in your route planner (ABRP) when you set off.",
  },
};

function pickLang(header = "") {
  for (const part of String(header).toLowerCase().split(",")) {
    const code = part.trim().slice(0, 2);
    if (TEXTS[code]) return code;
  }
  return "en";
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function page(lang, nonce) {
  const t = TEXTS[lang];
  const tj = JSON.stringify({
    range: t.range, charging: t.charging, now: t.now, off: t.off, error: t.error,
    updated: t.updated("__T__"), stale: t.stale("__T__"),
  }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${t.title}</title>
<style>
:root{--accent:#E0561B;--ink:#16181d;--muted:#5b5e66;--line:#e6e6e0}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f6f2;color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{width:min(92vw,380px);background:#fff;border-radius:24px;padding:28px 24px;box-shadow:0 10px 30px rgba(0,0,0,.06);border-top:8px solid var(--accent)}
h1{margin:0 0 18px;font-size:15px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
.level{font-size:72px;font-weight:700;line-height:1;letter-spacing:-.02em}
.level small{font-size:32px;font-weight:600}
.bar{height:14px;border-radius:99px;background:var(--line);overflow:hidden;margin:16px 0 12px}
.bar i{display:block;height:100%;background:var(--accent);border-radius:99px;transition:width .4s}
.row{display:flex;justify-content:space-between;align-items:center;font-size:16px}
.badge{font-size:13px;font-weight:600;color:#fff;background:var(--ink);padding:4px 10px;border-radius:99px}
.note{margin:16px 0 0;font-size:14px;line-height:1.45;color:var(--muted)}
.warn{color:#8a3a10}
[hidden]{display:none!important}
</style>
</head>
<body>
<main>
<h1>${t.title}</h1>
<div id="data" hidden>
<div class="level"><span id="lvl">–</span><small> %</small></div>
<div class="bar"><i id="fill" style="width:0"></i></div>
<div class="row"><span id="range"></span><span class="badge" id="chg" hidden>${t.charging}</span></div>
<p class="note" id="upd"></p>
<p class="note">${t.hint}</p>
</div>
<p class="note" id="msg"></p>
</main>
<script nonce="${nonce}">
const T=${tj};
const fmt=(d)=>new Intl.DateTimeFormat(document.documentElement.lang,{hour:"2-digit",minute:"2-digit"}).format(d);
async function load(){
  try{
    const r=await fetch(location.pathname.replace(/\\/$/,"")+"/data",{cache:"no-store"});
    const d=await r.json();
    const box=document.getElementById("data"),msg=document.getElementById("msg");
    if(!d.active){box.hidden=true;msg.textContent=T.off;return;}
    if(d.level==null){box.hidden=true;msg.textContent=T.error;return;}
    msg.textContent="";box.hidden=false;
    document.getElementById("lvl").textContent=d.level;
    document.getElementById("fill").style.width=Math.max(0,Math.min(100,d.level))+"%";
    document.getElementById("range").textContent=d.autonomy!=null?d.autonomy+" km "+T.range:"";
    document.getElementById("chg").hidden=!d.charging;
    const upd=document.getElementById("upd");
    if(d.updatedAt){
      const at=new Date(d.updatedAt),age=(Date.now()-at)/60000;
      upd.className="note"+(age>15?" warn":"");
      upd.textContent=age>15?T.stale.replace("__T__",fmt(at)):T.updated.replace("__T__",age<2?T.now:fmt(at));
    }else upd.textContent="";
  }catch(e){document.getElementById("msg").textContent=T.error;}
}
load();setInterval(load,60000);
</script>
</body>
</html>`;
}

function startPublicShare({ port, token, getStatus, rentalActive, log = console }) {
  if (!token || token.length < 12) {
    log.log("page publique batterie : désactivée (PUBLIC_SHARE_TOKEN absent ou trop court)");
    return null;
  }
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");

  // petite limite par adresse : 60 requêtes / minute
  const hits = new Map();
  app.use((req, res, next) => {
    const now = Date.now();
    const key = req.ip || "?";
    const h = hits.get(key) || { n: 0, t: now };
    if (now - h.t > 60000) { h.n = 0; h.t = now; }
    h.n += 1;
    hits.set(key, h);
    if (hits.size > 5000) hits.clear();
    if (h.n > 60) return res.status(429).end();
    res.set({
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
    });
    next();
  });

  let cache = { at: 0, value: null };
  async function snapshot() {
    if (Date.now() - cache.at < 30000) return cache.value;
    let value;
    try {
      const s = await getStatus();
      value = {
        level: Number.isFinite(s.level) ? s.level : null,
        autonomy: s.autonomy ?? null,
        charging: s.chargeStatus === "InProgress",
        updatedAt: s.updatedAt ? new Date(String(s.updatedAt).replace(" ", "T")).toISOString() : null,
      };
    } catch (e) {
      value = { level: null, autonomy: null, charging: false, updatedAt: null };
    }
    cache = { at: Date.now(), value };
    return value;
  }

  const check = (req, res, next) => (safeEqual(req.params.token, token) ? next() : res.status(404).end());

  app.get("/b/:token/data", check, async (req, res) => {
    if (!rentalActive()) return res.json({ active: false });
    res.json({ active: true, ...(await snapshot()) });
  });

  app.get("/b/:token", check, (req, res) => {
    const nonce = crypto.randomBytes(12).toString("base64");
    res.set("Content-Security-Policy",
      `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
    res.type("html").send(page(pickLang(req.get("accept-language")), nonce));
  });

  app.use((req, res) => res.status(404).end());
  app.listen(Number(port), () => log.log(`page publique batterie en écoute sur :${port}`));
  return app;
}

module.exports = { startPublicShare };
