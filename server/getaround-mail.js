// Lecture des e-mails Getaround (boîte dédiée, transfert automatique depuis la boîte habituelle)
// pour activer / désactiver le mode location au début et à la fin de chaque location.
//
// Seuls le type d'événement, le numéro de location et les heures sont conservés :
// le nom du locataire n'est jamais enregistré. Les e-mails sont seulement marqués comme lus.

const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");

const MONTHS_LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août",
  "septembre", "octobre", "novembre", "décembre"];
const MONTHS_SHORT = ["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"];

/** Date à l'heure de Bruxelles (gère l'heure d'été). */
function brusselsDate(year, month, day, hour, minute) {
  const asUtc = Date.UTC(year, month, day, hour, minute);
  const offsetAt = (t) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Brussels", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    }).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute) - t;
  };
  let t = asUtc - offsetAt(asUtc);
  t = asUtc - offsetAt(t); // seconde passe pour les changements d'heure
  return new Date(t);
}

/** « samedi 14 novembre 2026 à 11:44 » */
function parseLongDate(text) {
  const m = new RegExp(`(\\d{1,2})\\s+(${MONTHS_LONG.join("|")})\\s+(\\d{4})\\s+à\\s+(\\d{1,2}):(\\d{2})`, "i").exec(text);
  if (!m) return null;
  return brusselsDate(+m[3], MONTHS_LONG.indexOf(m[2].toLowerCase()), +m[1], +m[4], +m[5]);
}

/** Toutes les dates courtes « sam 14 nov. à 11:00 » (année déduite de la date de l'e-mail). */
function parseShortDates(text, reference) {
  const re = new RegExp(`(?:lun|mar|mer|jeu|ven|sam|dim)\\.?\\s+(\\d{1,2})\\s+(${MONTHS_SHORT.join("|")})\\.?\\s+à\\s+(\\d{1,2}):(\\d{2})`, "gi");
  const ref = reference || new Date();
  const out = [];
  for (const m of text.matchAll(re)) {
    const month = MONTHS_SHORT.indexOf(m[2].toLowerCase());
    let year = ref.getFullYear();
    if (month - ref.getMonth() > 6) year -= 1; // date de décembre lue en janvier, etc.
    if (ref.getMonth() - month > 6) year += 1;
    out.push(brusselsDate(year, month, +m[1], +m[3], +m[4]));
  }
  return out;
}

/**
 * Reconnaît un e-mail Getaround de début ou de fin de location.
 * @returns {{type: "start"|"end", rentalId: string, at: Date, plannedStart: Date|null, plannedEnd: Date|null} | null}
 */
function parseGetaroundEmail({ subject = "", from = "", text = "", html = "", date = null }) {
  const all = `${subject}\n${text}\n${html}`;
  const fromGetaround = /getaround\.com/i.test(from) || /getaround\.com/i.test(all);
  if (!fromGetaround) return null;

  // 1) marqueur technique des liens Getaround (le plus stable), 2) objet de l'e-mail en secours
  let type = null;
  if (/rental_owner_mailer(?:%2F|\/)rental_starts/i.test(all)) type = "start";
  else if (/rental_owner_mailer(?:%2F|\/)rental_ends/i.test(all)) type = "end";
  else if (/Location\s+#\d+\s+débutée/i.test(subject)) type = "start";
  else if (/Location\s+#\d+\s+terminée/i.test(subject)) type = "end";
  if (!type) return null;

  const idMatch = /Location\s+#(\d+)/i.exec(subject) || /dashboard\/rentals\/(\d+)/i.exec(all);
  if (!idMatch) return null;

  const plain = text || html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
  const label = type === "start" ? /Heure de déverrouillage([\s\S]{0,120})/i : /Heure de verrouillage([\s\S]{0,120})/i;
  const labelMatch = label.exec(plain);
  const actual = labelMatch ? parseLongDate(labelMatch[1]) : null;
  const planned = parseShortDates(plain, date || new Date());

  const distance = /Distance parcourue\s*(\d+)\s*km/i.exec(plain);
  const level = /Niveau de (?:carburant|batterie)[^0-9%]{0,40}(\d{1,3})\s*%/i.exec(plain);
  return {
    type,
    rentalId: idMatch[1],
    distanceKm: distance ? Number(distance[1]) : null,
    levelPercent: level ? Number(level[1]) : null,
    at: actual || date || new Date(),
    plannedStart: planned[0] || null,
    plannedEnd: planned[1] || null,
  };
}

/** Objet du type « Location #123 débutée / commencée / terminée / finie / clôturée … » */
function looksLikeRentalStartOrEnd(subject = "") {
  return /Location\s*(?:n°\s*)?#?\s*\d{5,}/i.test(subject) &&
    /(débu|commenc|démarr|termin|fini|clôtur|achev|rendu)/i.test(subject);
}

/**
 * Relève la boîte toutes les `intervalMs` et appelle `onEvent(event)` pour chaque e-mail reconnu.
 * `onStatus({lastCheck, lastError})` informe l'appli de l'état de la relève.
 */
function startMailWatcher({ user, password, host = "imap.gmail.com", port = 993, secure = true, intervalMs = 120000, onEvent, onStatus, log = console }) {
  let running = false;

  async function checkOnce() {
    if (running) return;
    running = true;
    const client = new ImapFlow({ host, port, secure, auth: { user, pass: password }, logger: false });
    try {
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      try {
        const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
        const uids = (await client.search({ seen: false, since }, { uid: true })) || [];
        if (uids.length) {
          const messages = await client.fetchAll(uids, { uid: true, source: true, internalDate: true }, { uid: true });
          messages.sort((a, b) => new Date(a.internalDate) - new Date(b.internalDate));
          for (const msg of messages) {
            try {
              const mail = await simpleParser(msg.source);
              const event = parseGetaroundEmail({
                subject: mail.subject || "",
                from: (mail.from && mail.from.text) || "",
                text: mail.text || "",
                html: typeof mail.html === "string" ? mail.html : "",
                date: mail.date || new Date(msg.internalDate),
              });
              if (event) await onEvent(event);
              else if (looksLikeRentalStartOrEnd(mail.subject)) {
                // ressemble à un début / une fin de location mais illisible : Getaround a peut-être changé ses e-mails
                await onEvent({ type: "unrecognized", subject: String(mail.subject || "").slice(0, 120), at: mail.date || new Date() });
              }
              // les autres e-mails Getaround (demandes, messages, versements…) sont ignorés en silence
            } catch (e) {
              log.warn("e-mail Getaround illisible :", e.message);
            }
          }
          await client.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
        }
      } finally {
        lock.release();
      }
      await client.logout();
      onStatus({ lastCheck: new Date().toISOString(), lastError: null });
    } catch (e) {
      log.warn("relève des e-mails impossible :", e.message);
      onStatus({ lastCheck: new Date().toISOString(), lastError: e.responseText || e.message });
      try { client.close(); } catch (_) { /* ignore */ }
    } finally {
      running = false;
    }
  }

  checkOnce();
  const timer = setInterval(checkOnce, intervalMs);
  return { stop: () => clearInterval(timer), checkOnce };
}

module.exports = { parseGetaroundEmail, startMailWatcher, brusselsDate, looksLikeRentalStartOrEnd };
