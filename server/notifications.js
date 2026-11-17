// Notifications push (Web Push) vers les appareils où l'appli est installée sur l'écran d'accueil.
// Chaque appareil choisit les types qu'il reçoit et son seuil de batterie basse.
// Les notifications ne contiennent jamais la position de la voiture ni le nom du locataire.

const fs = require("fs");
const path = require("path");
const webpush = require("web-push");

const TYPES = {
  rental_start: "Début de location",
  rental_end: "Fin de location",
  rental_overdue: "Fin de location non confirmée",
  charge_done: "Charge terminée",
  charge_interrupted: "Charge interrompue",
  battery_low: "Batterie basse",
  technical: "Problème technique",
};
const DEFAULT_PREFS = Object.fromEntries(Object.keys(TYPES).map((t) => [t, true]));
const DEFAULT_LOW_BATTERY = 20;

function createNotifier({ dataDir, subject = "mailto:corsa-app@localhost", log = console }) {
  const vapidFile = path.join(dataDir, "vapid.json");
  const subsFile = path.join(dataDir, "push-subscriptions.json");

  // clés VAPID créées au premier démarrage, puis conservées (sinon les abonnements deviennent invalides)
  let vapid;
  try { vapid = JSON.parse(fs.readFileSync(vapidFile, "utf8")); } catch (e) {
    vapid = webpush.generateVAPIDKeys();
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(vapidFile, JSON.stringify(vapid), { mode: 0o600 });
  }
  webpush.setVapidDetails(subject, vapid.publicKey, vapid.privateKey);

  const load = () => { try { return JSON.parse(fs.readFileSync(subsFile, "utf8")); } catch (e) { return []; } };
  const save = (subs) => {
    fs.writeFileSync(subsFile + ".tmp", JSON.stringify(subs, null, 1), { mode: 0o600 });
    fs.renameSync(subsFile + ".tmp", subsFile);
  };
  const find = (subs, endpoint) => subs.find((s) => s.subscription.endpoint === endpoint);
  const publicView = (s) => s && { prefs: { ...DEFAULT_PREFS, ...s.prefs }, lowBattery: s.lowBattery ?? DEFAULT_LOW_BATTERY };

  function subscribe(subscription, userAgent) {
    if (!subscription || !subscription.endpoint || !subscription.keys) throw new Error("abonnement invalide");
    const subs = load();
    let s = find(subs, subscription.endpoint);
    if (s) s.subscription = subscription;
    else {
      s = { subscription, prefs: { ...DEFAULT_PREFS }, lowBattery: DEFAULT_LOW_BATTERY,
        device: String(userAgent || "").slice(0, 120), createdAt: new Date().toISOString() };
      subs.push(s);
    }
    save(subs);
    return publicView(s);
  }

  function unsubscribe(endpoint) {
    save(load().filter((s) => s.subscription.endpoint !== endpoint));
  }

  function getPrefs(endpoint) {
    return publicView(find(load(), endpoint)) || null;
  }

  function setPrefs(endpoint, { prefs, lowBattery }) {
    const subs = load();
    const s = find(subs, endpoint);
    if (!s) throw new Error("appareil non abonné");
    if (prefs) for (const t of Object.keys(TYPES)) if (typeof prefs[t] === "boolean") s.prefs[t] = prefs[t];
    if (lowBattery != null) s.lowBattery = Math.min(50, Math.max(5, Math.round(Number(lowBattery))));
    save(subs);
    return publicView(s);
  }

  async function sendTo(s, payload) {
    try {
      await webpush.sendNotification(s.subscription, JSON.stringify(payload), { TTL: 6 * 3600, urgency: "high" });
      return true;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) return "gone"; // appareil désabonné
      log.warn("notification non envoyée :", e.statusCode || "", e.body || e.message);
      return false;
    }
  }

  /**
   * Envoie une notification d'un type donné à tous les appareils qui l'acceptent.
   * `filter(sub)` permet de restreindre (ex. seuil de batterie propre à chaque appareil).
   */
  async function notify(type, title, body, { tag, url = "/corsa", filter } = {}) {
    const subs = load();
    const targets = subs.filter((s) => ({ ...DEFAULT_PREFS, ...s.prefs })[type] !== false && (!filter || filter(s)));
    if (!targets.length) return 0;
    const payload = { title, body, tag: tag || type, url };
    const results = await Promise.all(targets.map((s) => sendTo(s, payload)));
    const gone = targets.filter((_, i) => results[i] === "gone").map((s) => s.subscription.endpoint);
    if (gone.length) save(load().filter((s) => !gone.includes(s.subscription.endpoint)));
    log.log(`notification « ${title} » envoyée à ${results.filter((r) => r === true).length} appareil(s)`);
    return results.filter((r) => r === true).length;
  }

  async function test(endpoint) {
    const s = find(load(), endpoint);
    if (!s) throw new Error("appareil non abonné");
    const ok = await sendTo(s, { title: "Ma Corsa-e", body: "Les notifications fonctionnent ✔", tag: "test", url: "/corsa" });
    if (ok !== true) throw new Error("envoi refusé par le service de notifications");
  }

  return {
    publicKey: vapid.publicKey, types: TYPES, subscribe, unsubscribe, getPrefs, setPrefs, notify, test,
    subscriptions: load,
  };
}

/**
 * Surveille l'état de la voiture (cache psacc) et détecte les événements de charge et de batterie.
 * `getStatus()` renvoie {level, autonomy, chargeStatus, plugged, moving, threshold} ou lance une erreur.
 */
function startVehicleMonitor({ notifier, getStatus, getMailError, intervalMs = 120000, statePath, log = console }) {
  const loadState = () => { try { return JSON.parse(fs.readFileSync(statePath, "utf8")); } catch (e) { return {}; } };
  const saveState = (st) => fs.writeFileSync(statePath, JSON.stringify(st));
  let failingSince = null;

  async function tick() {
    const st = loadState();
    // --- connexion à la voiture / psacc
    let v;
    try {
      v = await getStatus();
      failingSince = null;
      if (st.techPsaccNotified) { st.techPsaccNotified = false; }
    } catch (e) {
      failingSince = failingSince || Date.now();
      if (Date.now() - failingSince > 15 * 60000 && !st.techPsaccNotified) {
        st.techPsaccNotified = true;
        await notifier.notify("technical", "Connexion à la voiture perdue",
          "psacc ne répond plus depuis 15 minutes (en pause, ou VM arrêtée ?).", { tag: "tech-psacc" });
      }
      saveState(st);
      return;
    }

    // --- lecture des e-mails Getaround en échec depuis plus de 15 min
    const mailError = getMailError && getMailError();
    if (mailError && mailError.since && Date.now() - new Date(mailError.since).getTime() > 15 * 60000) {
      if (!st.techMailNotified) {
        st.techMailNotified = true;
        await notifier.notify("technical", "Lecture des e-mails Getaround en échec",
          "Le mode location ne s'activera pas automatiquement. Vérifie le mot de passe d'application.", { tag: "tech-mail" });
      }
    } else st.techMailNotified = false;

    // --- fin de charge / charge interrompue
    const prev = st.chargeStatus;
    const threshold = v.threshold || 100;
    if (prev === "InProgress" && v.chargeStatus && v.chargeStatus !== "InProgress") {
      const reached = v.level >= Math.min(threshold, 100) - 2 || v.chargeStatus === "Finished";
      if (reached) {
        await notifier.notify("charge_done", "Charge terminée",
          `Batterie à ${v.level} %${v.autonomy ? ` · ${v.autonomy} km d'autonomie` : ""}.`, { tag: "charge" });
      } else {
        await notifier.notify("charge_interrupted", "Charge interrompue",
          `La charge s'est arrêtée à ${v.level} %, avant ta limite de ${threshold} %${v.plugged ? "" : " (câble débranché)"}.`, { tag: "charge" });
      }
    }
    if (v.chargeStatus) st.chargeStatus = v.chargeStatus;

    // --- batterie basse (voiture ni en charge ni en route), une fois par épisode et par appareil
    const notified = new Set(st.lowBatteryNotified || []);
    const subs = notifier.subscriptions();
    const toWarn = [];
    for (const s of subs) {
      const limit = s.lowBattery ?? DEFAULT_LOW_BATTERY;
      const id = s.subscription.endpoint;
      if (v.level >= limit + 5) notified.delete(id);
      else if (v.level < limit && v.chargeStatus !== "InProgress" && !v.moving && !notified.has(id)) toWarn.push(id);
    }
    if (toWarn.length) {
      await notifier.notify("battery_low", "Batterie basse",
        `Batterie à ${v.level} %${v.autonomy ? ` · ${v.autonomy} km d'autonomie` : ""}.`,
        { tag: "battery", filter: (s) => toWarn.includes(s.subscription.endpoint) });
      toWarn.forEach((id) => notified.add(id));
    }
    st.lowBatteryNotified = [...notified];
    saveState(st);
  }

  const run = () => tick().catch((e) => log.warn("surveillance de la voiture :", e.message));
  setTimeout(run, 15000);
  const timer = setInterval(run, intervalMs);
  return { stop: () => clearInterval(timer), tick };
}

module.exports = { createNotifier, startVehicleMonitor, TYPES };
