import { useEffect, useState, type ReactNode } from "react";
import {
  ApiError,
  getChargings,
  getUpcomingRentals,
  saveLayout,
  type CardId,
  type ChargingRecord,
  type Layout,
  type UpcomingRental,
} from "./services/vehicleApi";

type ShellProps = { title: string; backIcon: ReactNode; closeIcon: ReactNode; onClose: () => void; children: ReactNode };

/** Coquille commune des pages détaillées (même style que Notifications / Nouveautés). */
export function DetailShell({ title, backIcon, closeIcon, onClose, children }: ShellProps) {
  return (
    <div className="configuration-screen">
      <div className="configuration-shell">
        <header className="configuration-header">
          <button aria-label="Retour" onClick={onClose} type="button">
            {backIcon}
          </button>
          <div>
            <span className="section-label">OPEL CORSA-E</span>
            <h2>{title}</h2>
          </div>
          <button aria-label="Fermer" onClick={onClose} type="button">
            {closeIcon}
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

const errText = (e: unknown, fallback: string) => (e instanceof ApiError && e.status === 0 ? "Serveur injoignable" : fallback);
const fmtDay = (iso: string) =>
  new Intl.DateTimeFormat("fr-BE", { weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));
const fmtSlot = (iso: string) =>
  new Intl.DateTimeFormat("fr-BE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const fmtTime = (iso: string) => new Intl.DateTimeFormat("fr-BE", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const fmtDur = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}` : `${min} min`);
const n1 = (n: number) => n.toLocaleString("fr-BE", { maximumFractionDigits: 1 });

// ---------------------------------------------------------------------------
// Historique des recharges
// ---------------------------------------------------------------------------
export function ChargesScreen(props: Omit<ShellProps, "title" | "children">) {
  const [list, setList] = useState<ChargingRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getChargings()
      .then((r) => setList(r.chargings))
      .catch((e) => setError(errText(e, "Historique des recharges indisponible")));
  }, []);
  const month = list?.filter((c) => Date.now() - new Date(c.start).getTime() < 30 * 86400000) ?? [];
  const monthKwh = month.reduce((a, c) => a + (c.kwh ?? 0), 0);
  return (
    <DetailShell title="Recharges" {...props}>
      {error ? (
        <section className="configuration-card notif-card">
          <h3>{error}</h3>
        </section>
      ) : !list ? (
        <section className="configuration-card notif-card">
          <p>Chargement…</p>
        </section>
      ) : (
        <>
          <section className="configuration-card notif-card conso-hero">
            <span className="section-label">30 DERNIERS JOURS</span>
            <div className="conso-big">
              {n1(monthKwh)} <small>kWh</small>
            </div>
            <p className="muted">
              {month.length} recharge{month.length > 1 ? "s" : ""}
            </p>
          </section>
          <section className="configuration-card notif-card">
            <h3>Dernières recharges</h3>
            {list.length === 0 ? (
              <p className="muted">Aucune recharge enregistrée pour l’instant.</p>
            ) : (
              <ul className="conso-trips">
                {list.map((c) => (
                  <li key={c.start}>
                    <div>
                      <strong>
                        {fmtDay(c.start)} · {fmtTime(c.start)}
                        {c.stop ? ` → ${fmtTime(c.stop)}` : " · en cours"}
                      </strong>
                      <span className="muted small">
                        {c.from != null && c.to != null ? `${c.from} % → ${c.to} %` : "—"}
                        {c.minutes != null ? ` · ${fmtDur(c.minutes)}` : ""}
                      </span>
                    </div>
                    <div className="conso-trip-value">
                      <strong>{c.kwh != null ? `${n1(c.kwh)} kWh` : "—"}</strong>
                      {c.price != null && <span className="conso-tag">{c.price.toLocaleString("fr-BE", { style: "currency", currency: "EUR" })}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="muted small">Recharges faites pendant les locations comprises.</p>
          </section>
        </>
      )}
    </DetailShell>
  );
}

// ---------------------------------------------------------------------------
// Locations prévues
// ---------------------------------------------------------------------------
export function RentalsScreen(props: Omit<ShellProps, "title" | "children"> & { getaroundUrl?: string; openExternal: (url: string) => void }) {
  const { getaroundUrl, openExternal, ...shell } = props;
  const [list, setList] = useState<UpcomingRental[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getUpcomingRentals()
      .then((r) => setList(r.rentals))
      .catch((e) => setError(errText(e, "Planning indisponible")));
  }, []);
  return (
    <DetailShell title="Locations prévues" {...shell}>
      <section className="configuration-card notif-card">
        {error ? (
          <h3>{error}</h3>
        ) : !list ? (
          <p>Chargement…</p>
        ) : list.length === 0 ? (
          <p>Aucune location prévue.</p>
        ) : (
          <ul className="conso-trips">
            {list.map((r) => {
              const hours = Math.round((new Date(r.end).getTime() - new Date(r.start).getTime()) / 3600000);
              return (
                <li key={r.rentalId}>
                  <div>
                    <strong>{fmtSlot(r.start)}</strong>
                    <span className="muted small">→ {fmtSlot(r.end)}</span>
                  </div>
                  <div className="conso-trip-value">
                    <strong>{hours >= 24 ? `${Math.round(hours / 24)} j` : `${hours} h`}</strong>
                    <span className="conso-tag">#{r.rentalId}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="muted small">D’après les e-mails Getaround (réservations, modifications, annulations).</p>
        {getaroundUrl && (
          <button className="ghost-button" onClick={() => openExternal(getaroundUrl)} type="button">
            Ouvrir Getaround
          </button>
        )}
      </section>
    </DetailShell>
  );
}

// ---------------------------------------------------------------------------
// Position (grande carte)
// ---------------------------------------------------------------------------
export function LocationScreen(
  props: Omit<ShellProps, "title" | "children"> & {
    map: ReactNode;
    place: string;
    detail: string;
    mapsUrl: string | null;
    hidden: boolean;
    openExternal: (url: string) => void;
  },
) {
  const { map, place, detail, mapsUrl, hidden, openExternal, ...shell } = props;
  return (
    <DetailShell title="Position" {...shell}>
      <section className="configuration-card notif-card">
        {hidden ? (
          <>
            <h3>Position masquée</h3>
            <p className="muted">Mode location : la position n’est pas affichée, et le parcours est effacé à la fin de la location.</p>
          </>
        ) : (
          <>
            <div className="location-detail-map">{map}</div>
            <h3>{place}</h3>
            <p className="muted">{detail}</p>
            {mapsUrl && (
              <button className="ghost-button" onClick={() => openExternal(mapsUrl)} type="button">
                Ouvrir dans Plans / Google Maps
              </button>
            )}
          </>
        )}
      </section>
    </DetailShell>
  );
}

// ---------------------------------------------------------------------------
// Personnaliser l'accueil
// ---------------------------------------------------------------------------
const CARD_LABELS: Record<CardId, { title: string; text: string }> = {
  location: { title: "Position", text: "Carte et adresse de la voiture" },
  nextRental: { title: "Prochaine location", text: "D’après les e-mails Getaround" },
  consumption: { title: "Consommation", text: "Moyenne 30 jours et autonomie réelle" },
  charges: { title: "Statistiques de recharge", text: "Dernière recharge et historique" },
};

export function LayoutScreen(
  props: Omit<ShellProps, "title" | "children"> & { layout: Layout; onChange: (layout: Layout) => void; arrowUp: ReactNode; arrowDown: ReactNode },
) {
  const { layout, onChange, arrowUp, arrowDown, ...shell } = props;
  const [draft, setDraft] = useState<Layout>(layout);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async (next: Layout) => {
    setDraft(next);
    setSaving(true);
    setError(null);
    try {
      const saved = await saveLayout(next);
      onChange(saved);
    } catch (e) {
      setError(errText(e, "Enregistrement impossible"));
    } finally {
      setSaving(false);
    }
  };
  const move = (i: number, d: -1 | 1) => {
    const cards = [...draft.cards];
    const j = i + d;
    if (j < 0 || j >= cards.length) return;
    [cards[i], cards[j]] = [cards[j], cards[i]];
    void apply({ ...draft, cards });
  };
  const toggle = (i: number) => {
    const cards = draft.cards.map((c, k) => (k === i ? { ...c, on: !c.on } : c));
    void apply({ ...draft, cards });
  };

  return (
    <DetailShell title="Personnaliser l’accueil" {...shell}>
      <section className="configuration-card notif-card">
        <h3>Toujours affichés</h3>
        <p className="muted small">
          La voiture, les commandes et la limite de charge restent en haut de l’accueil. Pendant une charge, l’encart de recharge
          s’affiche automatiquement.
        </p>
      </section>
      <section className="configuration-card notif-card">
        <h3>Cartes de l’accueil</h3>
        <p className="muted small">Activez les cartes et choisissez leur ordre. Touchez une carte sur l’accueil pour ouvrir son détail.</p>
        <ul className="layout-list">
          {draft.cards.map((c, i) => (
            <li key={c.id}>
              <div className="layout-move">
                <button aria-label={`Monter ${CARD_LABELS[c.id].title}`} disabled={i === 0 || saving} onClick={() => move(i, -1)} type="button">
                  {arrowUp}
                </button>
                <button
                  aria-label={`Descendre ${CARD_LABELS[c.id].title}`}
                  disabled={i === draft.cards.length - 1 || saving}
                  onClick={() => move(i, 1)}
                  type="button"
                >
                  {arrowDown}
                </button>
              </div>
              <button aria-pressed={c.on} className="notif-row" disabled={saving} onClick={() => toggle(i)} type="button">
                <span>
                  <strong>{CARD_LABELS[c.id].title}</strong>
                  <small>{CARD_LABELS[c.id].text}</small>
                </span>
                <span className={`toggle ${c.on ? "on" : ""}`}>
                  <i />
                </span>
              </button>
            </li>
          ))}
        </ul>
        {error && <p className="err-text">{error}</p>}
      </section>
    </DetailShell>
  );
}
