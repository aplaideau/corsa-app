// API propriétaire Getaround (https://api-eu.getaround.com/owner/v1).
//
// - Webhooks (temps réel) : réservation, annulation, changement d'horaire, changement de
//   voiture, check-in, check-out. Signés par Getaround (X-Drivy-Signature = "sha1=" + HMAC-SHA1).
// - Vérification régulière (filet de sécurité) : locations réservées récemment, check-ins et
//   check-outs des derniers jours.
// - Revenus : factures (montant reversé au propriétaire).
// Pensé pour plusieurs voitures : chaque location garde son car_id.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");

const BASE = process.env.GETAROUND_API_BASE || "https://api-eu.getaround.com/owner/v1";
const DAY = 86400000;

function createGetaroundApi({ token, webhookSecret, carIds = [], dataDir, schedule, onRentalEvent, log = console }) {
  if (!token) return null;
  const stateFile = path.join(dataDir, "getaround-api.json");
  const load = () => { try { return JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch (e) { return {}; } };
  const save = (s) => { fs.writeFileSync(stateFile + ".tmp", JSON.stringify(s)); fs.renameSync(stateFile + ".tmp", stateFile); };
  const update = (patch) => save({ ...load(), ...patch });
  const ourCar = (carId) => !carIds.length || carIds.includes(String(carId));

  // ---- client HTTP (pagination par l'en-tête Link, comme le demande la doc) ----
  async function get(pathOrUrl, params) {
    let url = pathOrUrl.startsWith("http") ? pathOrUrl : `${BASE}${pathOrUrl}`;
    if (params) url += `?${new URLSearchParams(params)}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (r.status === 404) return { data: null, next: null };
    if (!r.ok) throw new Error(`Getaround API ${r.status} sur ${pathOrUrl}`);
    const link = r.headers.get("link") || "";
    const next = (/<([^>]+)>;\s*rel="next"/.exec(link) || [])[1] || null;
    return { data: await r.json(), next };
  }
  async function getAll(pathname, params) {
    const out = [];
    let { data, next } = await get(pathname, { ...params, per_page: "100" });
    for (let guard = 0; ; guard++) {
      const items = Array.isArray(data) ? data : data && Array.isArray(data.data) ? data.data : [];
      out.push(...items);
      if (!next || guard > 50) break;
      ({ data, next } = await get(next));
    }
    return out;
  }
  // l'API refuse les plages de plus de 30 jours : découpage
  async function getRange(pathname, from, to) {
    const out = [];
    for (let a = from.getTime(); a < to.getTime(); a += 30 * DAY) {
      const b = Math.min(a + 30 * DAY, to.getTime());
      out.push(...(await getAll(pathname, { start_date: new Date(a).toISOString(), end_date: new Date(b).toISOString() })));
    }
    // les fenêtres se touchent : retirer les doublons
    const seen = new Set();
    return out.filter((x) => {
      const k = x.id != null ? `id:${x.id}` : `${x.rental_id}:${x.occurred_at}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  const unwrap = (d) => (d && d.data && !Array.isArray(d.data) ? d.data : d);

  // ---- traitements communs (webhooks et vérification régulière) ----
  async function refreshRental(id) {
    const { data } = await get(`/rentals/${id}.json`);
    const r = unwrap(data);
    if (!r || !r.id || !ourCar(r.car_id)) return null;
    schedule.upsertFromApi({ rentalId: r.id, start: r.starts_at, end: r.ends_at, carId: r.car_id, bookedAt: r.booked_at });
    return r;
  }
  async function handleCheckin(c) {
    if (!c || !c.rental_id) return;
    const rental = await refreshRental(c.rental_id);
    if (!rental) return;
    await onRentalEvent({
      type: "start", source: "api", rentalId: String(c.rental_id), at: new Date(c.occurred_at),
      plannedEnd: rental.ends_at ? new Date(rental.ends_at) : null,
      levelPercent: c.fuel_level ?? null, mileage: c.mileage ?? null,
    });
  }
  async function handleCheckout(c) {
    if (!c || !c.rental_id) return;
    const rental = await refreshRental(c.rental_id);
    if (!rental) return;
    await onRentalEvent({
      type: "end", source: "api", rentalId: String(c.rental_id), at: new Date(c.occurred_at),
      distanceKm: c.distance_driven ?? null, levelPercent: c.fuel_level ?? null, mileage: c.mileage ?? null,
    });
  }

  // ---- vérification régulière (toutes les 10 min) ----
  async function sync() {
    const now = new Date();
    const rentals = await getRange("/rentals.json", new Date(now - 90 * DAY), now); // réservées ces 90 derniers jours
    for (const r of rentals) {
      if (!ourCar(r.car_id)) continue;
      schedule.upsertFromApi({ rentalId: r.id, start: r.starts_at, end: r.ends_at, carId: r.car_id, bookedAt: r.booked_at });
    }
    const since = new Date(now - 2 * DAY);
    const checkins = await getRange("/checkins.json", since, now);
    const checkouts = await getRange("/checkouts.json", since, now);
    const out = new Set(checkouts.map((c) => String(c.rental_id)));
    for (const c of checkins.sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at))) {
      if (!out.has(String(c.rental_id))) await handleCheckin(c); // location en cours
    }
    for (const c of checkouts.sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at))) await handleCheckout(c);
    update({ lastSync: now.toISOString(), lastError: null });
  }
  const runSync = () => sync().catch((e) => { update({ lastError: e.message, lastErrorAt: new Date().toISOString() }); log.warn("API Getaround :", e.message); });
  setTimeout(runSync, 20000);
  setInterval(runSync, 10 * 60000);

  // ---- webhooks ----
  const router = express.Router();
  router.post("/getaround/webhook", express.raw({ type: "*/*", limit: "64kb" }), (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    if (!webhookSecret) return res.status(503).end();
    const expected = "sha1=" + crypto.createHmac("sha1", webhookSecret).update(raw).digest("hex");
    const got = String(req.get("x-drivy-signature") || "");
    const ok = got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
    if (!ok) return res.status(401).end();
    res.status(200).end(); // accuser réception tout de suite, traiter ensuite
    let event;
    try {
      const text = raw.toString("utf8");
      const form = /^payload=/.test(text) ? new URLSearchParams(text).get("payload") : null;
      event = JSON.parse(form || text);
    } catch (e) { return log.warn("webhook Getaround illisible"); }
    processWebhook(event).catch((e) => log.warn("webhook Getaround :", e.message));
  });

  async function processWebhook(event) {
    const type = String(event.type || "");
    const id = event.data && event.data.rental_id;
    const key = `${type}:${id}:${event.occurred_at}`;
    const st = load();
    const seen = Array.isArray(st.seen) ? st.seen : [];
    if (seen.includes(key)) return; // événement déjà reçu (Getaround peut renvoyer)
    update({ seen: [...seen.slice(-300), key], lastWebhook: { type, at: new Date().toISOString() } });
    log.log(`webhook Getaround : ${type}${id ? ` #${id}` : ""}`);
    if (type === "ping" || !id) return;
    if (type === "rental.canceled") {
      const { data } = await get(`/rentals/${id}.json`).catch(() => ({ data: null }));
      const r = unwrap(data);
      if (r && r.car_id != null && !ourCar(r.car_id)) return;
      schedule.cancel(id);
    } else if (type === "rental.booked" || type === "rental.times_changed" || type === "rental.car_switched") {
      await refreshRental(id);
    } else if (type === "rental.car_checked_in") {
      const { data } = await get(`/rentals/${id}/checkin.json`);
      await handleCheckin(unwrap(data));
    } else if (type === "rental.car_checked_out") {
      const { data } = await get(`/rentals/${id}/checkout.json`);
      await handleCheckout(unwrap(data));
    }
  }

  // ---- revenus (factures : montant reversé au propriétaire) ----
  let revenueCache = { at: 0, value: null };
  async function revenue() {
    if (revenueCache.value && Date.now() - revenueCache.at < 30 * 60000) return revenueCache.value;
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 2, 1); // 3 mois civils
    const invoices = await getRange("/invoices.json", from, now);
    const rentalIds = new Set(
      Object.entries(JSON.parse(fs.existsSync(path.join(dataDir, "schedule.json")) ? fs.readFileSync(path.join(dataDir, "schedule.json"), "utf8") : '{"rentals":{}}').rentals || {})
        .filter(([, r]) => !carIds.length || !r.carId || carIds.includes(String(r.carId)))
        .map(([k]) => k),
    );
    const list = invoices
      .filter((i) => i.product_type === "Rental")
      .filter((i) => !carIds.length || rentalIds.has(String(i.product_id)))
      .map((i) => ({
        id: i.id, rentalId: String(i.product_id), at: i.emitted_at,
        amount: Math.round(Number(i.total_price) || 0) / 100, currency: i.currency || "EUR",
      }))
      .sort((a, b) => new Date(b.at) - new Date(a.at));
    const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const months = {};
    for (const i of list) {
      const k = key(new Date(i.at));
      months[k] = months[k] || { month: k, total: 0, count: 0 };
      months[k].total = Math.round((months[k].total + i.amount) * 100) / 100;
      months[k].count += 1;
    }
    const thisMonth = key(now);
    const prevMonth = key(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const value = {
      thisMonth: months[thisMonth] || { month: thisMonth, total: 0, count: 0 },
      prevMonth: months[prevMonth] || { month: prevMonth, total: 0, count: 0 },
      months: Object.values(months).sort((a, b) => b.month.localeCompare(a.month)),
      invoices: list.slice(0, 60),
      currency: (list[0] && list[0].currency) || "EUR",
    };
    revenueCache = { at: Date.now(), value };
    return value;
  }

  return {
    router,
    revenue,
    syncNow: runSync,
    status: () => { const s = load(); return { lastSync: s.lastSync || null, lastError: s.lastError || null, lastWebhook: s.lastWebhook || null, webhook: Boolean(webhookSecret) }; },
  };
}

module.exports = { createGetaroundApi };
