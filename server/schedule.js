// Planning des locations Getaround, tenu à jour par les e-mails :
// réservation confirmée → ajoutée, modification → nouvelles dates, annulation → retirée,
// début / fin de location → en cours / terminée.
// Seuls le numéro de location et les dates sont conservés (jamais le nom du locataire).

const fs = require("fs");
const path = require("path");

const KEEP_AFTER_END_MS = 2 * 24 * 3600 * 1000;

function createSchedule({ dataDir }) {
  const file = path.join(dataDir, "schedule.json");
  const load = () => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return { rentals: {} }; } };
  const save = (data) => {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file + ".tmp", JSON.stringify(data, null, 1));
    fs.renameSync(file + ".tmp", file);
  };
  const iso = (d) => (d ? new Date(d).toISOString() : null);

  function prune(data) {
    for (const [id, r] of Object.entries(data.rentals)) {
      const end = r.end ? new Date(r.end).getTime() : new Date(r.updatedAt).getTime();
      if (end < Date.now() - KEEP_AFTER_END_MS) delete data.rentals[id];
    }
  }

  /** Applique un événement e-mail. Un e-mail plus ancien que la dernière info connue est ignoré. */
  function apply(event) {
    if (!event || !event.rentalId) return false;
    const data = load();
    const at = iso(event.at) || new Date().toISOString();
    const current = data.rentals[event.rentalId];
    // un début / une fin de location s'applique toujours (les dates, elles, peuvent venir de l'API, plus récente)
    const transition = event.type === "start" || event.type === "end";
    if (!transition && current && current.updatedAt && new Date(current.updatedAt) > new Date(at)) return false;

    const r = { ...(current || {}), updatedAt: transition && current && current.updatedAt > at ? current.updatedAt : at };
    const start = iso(event.plannedStart);
    const end = iso(event.plannedEnd);
    switch (event.type) {
      case "booked":
      case "modified":
        if (r.start !== start) r.reminded = false; // nouvelle heure de début : nouveau rappel
        r.start = start || r.start;
        r.end = end || r.end;
        if (!["started", "ended"].includes(r.status)) r.status = "booked";
        if (!r.bookedAt) r.bookedAt = at;
        break;
      case "cancelled":
        r.status = "cancelled";
        r.start = r.start || start;
        r.end = r.end || end;
        break;
      case "start":
        r.status = "started";
        r.start = r.start || start;
        r.end = end || r.end;
        break;
      case "end":
        r.status = "ended";
        break;
      default:
        return false;
    }
    data.rentals[event.rentalId] = r;
    prune(data);
    save(data);
    return true;
  }

  /** Mise à jour depuis l'API Getaround (source de vérité pour les dates ; n'annule ni ne ressuscite). */
  function upsertFromApi({ rentalId, start, end, carId = null, bookedAt = null }) {
    if (!rentalId || !start || !end) return false;
    const data = load();
    const id = String(rentalId);
    const r = { ...(data.rentals[id] || {}) };
    if (r.start !== iso(start)) r.reminded = false;
    r.start = iso(start);
    r.end = iso(end);
    if (carId != null) r.carId = String(carId);
    if (!r.status) r.status = "booked";
    if (!r.bookedAt) r.bookedAt = iso(bookedAt) || new Date().toISOString();
    r.updatedAt = new Date().toISOString();
    r.source = "api";
    data.rentals[id] = r;
    prune(data);
    save(data);
    return true;
  }

  /** Annulation reçue de l'API (webhook rental.canceled). */
  function cancel(rentalId) {
    const data = load();
    const id = String(rentalId);
    data.rentals[id] = { ...(data.rentals[id] || {}), status: "cancelled", updatedAt: new Date().toISOString() };
    save(data);
  }

  /** Locations confirmées pas encore commencées (ou dont le début n'a pas encore été confirmé). */
  function upcoming() {
    const now = Date.now();
    return Object.entries(load().rentals)
      .filter(([, r]) => r.status === "booked" && r.start && r.end && new Date(r.end).getTime() > now)
      .map(([rentalId, r]) => ({ rentalId, ...r }))
      .sort((a, b) => new Date(a.start) - new Date(b.start));
  }

  function next() {
    const r = upcoming()[0];
    return r ? { rentalId: r.rentalId, start: r.start, end: r.end } : null;
  }

  function markReminded(rentalId) {
    const data = load();
    if (data.rentals[rentalId]) { data.rentals[rentalId].reminded = true; save(data); }
  }

  return { apply, upsertFromApi, cancel, upcoming, next, markReminded };
}

module.exports = { createSchedule };
